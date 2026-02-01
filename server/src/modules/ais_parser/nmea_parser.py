
from typing import Dict, Optional, Tuple, List
from time import time
from pyais import decode
from pyais.exceptions import InvalidNMEAMessageException
import re

from src.core.logger import LoggerMixin


class NMEAParser(LoggerMixin):

    def __init__(self, fragment_timeout: int = 60):
        self._logger_context = {'component': 'nmea-parser'}
        self.stats = {
            'total_parsed': 0,
            'total_errors': 0,
            'by_type': {},
            'fragments_buffered': 0,
            'fragments_assembled': 0,
            'fragments_expired': 0,
            'invalid_sentences': 0,
            'corrupted_prefix_fixed': 0,
        }

        self.fragment_buffer: Dict[Tuple[int, str, str], Dict] = {}
        self.fragment_timeout = fragment_timeout

        self.nmea_pattern = re.compile(r'^[!$](AIVDM|ABVDM|AIVDO|ABVDO),.*\*[0-9A-F]{2}$')

    def parse(self, nmea_sentence: str) -> Optional[Dict]:
        nmea_sentence = nmea_sentence.strip()

        if 'VDO' in nmea_sentence:
            self.logger.info("VDO RAW", sentence=nmea_sentence[:100])

        nmea_sentence = self._fix_corrupted_prefix(nmea_sentence)

        if not self._is_valid_nmea(nmea_sentence):
            self.stats['invalid_sentences'] += 1
            return None

        self._expire_old_fragments()

        is_own_ship = 'VDO' in nmea_sentence

        complete_sentence = self._handle_fragments(nmea_sentence)

        if complete_sentence is None:
            return None

        try:
            if isinstance(complete_sentence, tuple):
                decoded = decode(*complete_sentence)
            else:
                decoded = decode(complete_sentence)

            if not decoded:
                return None

            msg_type = decoded.msg_type

            self.stats['total_parsed'] += 1
            self.stats['by_type'][msg_type] = self.stats['by_type'].get(msg_type, 0) + 1

            message = self._to_message_format(decoded)

            if is_own_ship:
                message['isOwnShip'] = True
                self.logger.info(
                    "VDO PARSED",
                    mmsi=message.get('mmsi'),
                    type=msg_type,
                    lat=message.get('lat'),
                    lon=message.get('lon')
                )

            return message

        except InvalidNMEAMessageException as e:
            self.stats['total_errors'] += 1
            sentence_preview = str(complete_sentence)[:80] if not isinstance(complete_sentence, tuple) else str(complete_sentence[0])[:80]
            self.logger.debug("Invalid NMEA message", error=str(e), sentence=sentence_preview)
            return None
        except Exception as e:
            self.stats['total_errors'] += 1
            sentence_preview = str(complete_sentence)[:80] if not isinstance(complete_sentence, tuple) else str(complete_sentence[0])[:80]
            self.logger.warning("Parse error", error=str(e), sentence=sentence_preview)
            return None

    def _is_valid_nmea(self, sentence: str) -> bool:
        if not sentence or len(sentence) < 15:
            return False

        if not (sentence.startswith('!') or sentence.startswith('$')):
            return False

        if not any(x in sentence for x in ['AIVDM', 'ABVDM', 'AIVDO', 'ABVDO']):
            return False

        if '*' not in sentence:
            return False

        return True

    def _fix_corrupted_prefix(self, sentence: str) -> str:
        if sentence.startswith(('!AIVDM,', '!ABVDM,', '!AIVDO,', '!ABVDO,', '$AIVDM,', '$ABVDM,')):
            return sentence

        for identifier in ['AIVDM', 'ABVDM', 'AIVDO', 'ABVDO']:
            idx = sentence.rfind(identifier)
            if idx > 0:
                prefix_start = idx - 1

                while prefix_start >= max(0, idx - 3) and sentence[prefix_start] not in ('!', '$'):
                    prefix_start -= 1

                if prefix_start >= 0 and sentence[prefix_start] in ('!', '$'):
                    fixed = sentence[prefix_start:]

                    if len(fixed) > len(identifier) + 2 and fixed[len(identifier) + 1] == ',':
                        self.stats['corrupted_prefix_fixed'] += 1
                        return fixed

        return sentence

    def _parse_nmea_fields(self, sentence: str) -> Optional[Tuple[int, int, str, str]]:
        try:
            parts = sentence.split(',')
            if len(parts) < 5:
                return None

            fragment_count = int(parts[1])
            fragment_num = int(parts[2])
            seq_id = parts[3] if parts[3] else '0'
            channel = parts[4][0] if len(parts[4]) > 0 else 'A'

            return (fragment_count, fragment_num, seq_id, channel)
        except (ValueError, IndexError):
            return None

    def _handle_fragments(self, sentence: str):
        metadata = self._parse_nmea_fields(sentence)

        if metadata is None:
            return sentence

        fragment_count, fragment_num, seq_id, channel = metadata

        if fragment_count == 1:
            return sentence

        buffer_key = (fragment_count, seq_id, channel)

        if buffer_key not in self.fragment_buffer:
            self.fragment_buffer[buffer_key] = {
                'fragments': {},
                'timestamp': time(),
            }

        self.fragment_buffer[buffer_key]['fragments'][fragment_num] = sentence
        self.stats['fragments_buffered'] += 1

        fragments_dict = self.fragment_buffer[buffer_key]['fragments']
        expected_fragments = set(range(1, fragment_count + 1))
        received_fragments = set(fragments_dict.keys())

        if expected_fragments == received_fragments:
            self.stats['fragments_assembled'] += 1

            del self.fragment_buffer[buffer_key]

            return self._assemble_multipart_sentence(fragments_dict, fragment_count)
        else:
            return None

    def _assemble_multipart_sentence(self, fragments: Dict[int, str], fragment_count: int) -> tuple:
        ordered = tuple(fragments[i] for i in range(1, fragment_count + 1))
        return ordered

    def _expire_old_fragments(self) -> None:
        current_time = time()
        expired_keys = []

        for key, data in self.fragment_buffer.items():
            if current_time - data['timestamp'] > self.fragment_timeout:
                expired_keys.append(key)

        for key in expired_keys:
            fragments = self.fragment_buffer[key]['fragments']
            self.stats['fragments_expired'] += len(fragments)
            del self.fragment_buffer[key]

        if expired_keys:
            self.logger.debug("Expired old fragments", count=len(expired_keys))

    def _to_message_format(self, decoded) -> Dict:
        msg_type = decoded.msg_type
        message = {
            'type': msg_type,
            'mmsi': str(decoded.mmsi),
        }

        if msg_type in (1, 2, 3, 18, 19):
            if hasattr(decoded, 'lat') and hasattr(decoded, 'lon'):
                lat = decoded.lat
                lon = decoded.lon

                if lat != 91.0 and lon != 181.0:
                    message['lat'] = lat
                    message['lon'] = lon

            if hasattr(decoded, 'speed'):
                speed = decoded.speed
                if speed != 1023:
                    message['speed'] = speed

            if hasattr(decoded, 'course'):
                course = decoded.course
                if course != 360.0:
                    message['course'] = course

            if hasattr(decoded, 'heading'):
                heading = decoded.heading
                if heading != 511:
                    message['heading'] = heading

            if hasattr(decoded, 'status'):
                message['status'] = decoded.status

        elif msg_type == 5:
            if hasattr(decoded, 'shipname'):
                name = decoded.shipname.strip()
                if name:
                    message['name'] = name

            if hasattr(decoded, 'imo'):
                imo = decoded.imo
                if imo and imo != 0:
                    message['imo'] = str(imo)

            if hasattr(decoded, 'callsign'):
                callsign = decoded.callsign.strip()
                if callsign:
                    message['callsign'] = callsign

            if hasattr(decoded, 'ship_type'):
                message['shiptype'] = decoded.ship_type

            if hasattr(decoded, 'to_bow') and hasattr(decoded, 'to_stern'):
                to_bow = decoded.to_bow
                to_stern = decoded.to_stern
                if to_bow is not None and to_stern is not None:
                    message['length'] = to_bow + to_stern

            if hasattr(decoded, 'to_port') and hasattr(decoded, 'to_starboard'):
                to_port = decoded.to_port
                to_starboard = decoded.to_starboard
                if to_port is not None and to_starboard is not None:
                    message['width'] = to_port + to_starboard

        return message

    def get_stats(self) -> Dict:
        
        return {
            'total_parsed': self.stats['total_parsed'],
            'total_errors': self.stats['total_errors'],
            'by_type': self.stats['by_type'],
            'fragments_buffered': self.stats['fragments_buffered'],
            'fragments_assembled': self.stats['fragments_assembled'],
            'fragments_expired': self.stats['fragments_expired'],
            'invalid_sentences': self.stats['invalid_sentences'],
            'corrupted_prefix_fixed': self.stats['corrupted_prefix_fixed'],
            'fragments_in_buffer': len(self.fragment_buffer),
            'error_rate': (
                self.stats['total_errors'] /
                (self.stats['total_parsed'] + self.stats['total_errors'])
                if (self.stats['total_parsed'] + self.stats['total_errors']) > 0
                else 0
            ),
        }

    def reset_stats(self) -> None:
        
        self.stats = {
            'total_parsed': 0,
            'total_errors': 0,
            'by_type': {},
            'fragments_buffered': 0,
            'fragments_assembled': 0,
            'fragments_expired': 0,
            'invalid_sentences': 0,
            'corrupted_prefix_fixed': 0,
        }
