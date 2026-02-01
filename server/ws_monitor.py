
import asyncio
import json
import argparse
import sys
from datetime import datetime
from typing import Dict, Optional
import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException


class Colors:
    
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

    HEADER = '\033[95m'
    INFO = '\033[94m'
    SUCCESS = '\033[92m'
    WARNING = '\033[93m'
    ERROR = '\033[91m'

    CYAN = '\033[96m'
    YELLOW = '\033[93m'
    GREEN = '\033[92m'
    MAGENTA = '\033[95m'

    RED_BG = '\033[41m'
    WHITE = '\033[97m'


class WSMonitor:
    

    def __init__(self, host: str = "localhost", port: int = 8080,
                 filter_type: Optional[str] = None, filter_watchlist: bool = False,
                 stream: str = "all"):
        self.host = host
        self.port = port

        if stream == "watchlist":
            self.url = f"ws://{host}:{port}/ws/watchlist"
        else:
            self.url = f"ws://{host}:{port}/ws"

        self.filter_type = int(filter_type) if filter_type and filter_type.isdigit() else None
        self.filter_watchlist = filter_watchlist

        self.stats = {
            'total_received': 0,
            'by_type': {},
            'watchlisted': 0,
            'filtered': 0,
            'start_time': datetime.now()
        }

        self.running = False

    def print_header(self):
        
        print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.HEADER}DarkFleet WebSocket Monitor{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.RESET}")
        print(f"{Colors.CYAN}Connecting to: {Colors.WHITE}{self.url}{Colors.RESET}")

        if self.filter_type:
            print(f"{Colors.YELLOW}Filter: Type {self.filter_type} messages only{Colors.RESET}")
        if self.filter_watchlist:
            print(f"{Colors.YELLOW}Filter: Watchlisted vessels only{Colors.RESET}")

        print(f"{Colors.DIM}Press Ctrl+C to stop{Colors.RESET}\n")

    def print_stats(self):
        
        runtime = (datetime.now() - self.stats['start_time']).total_seconds()
        msg_per_sec = self.stats['total_received'] / runtime if runtime > 0 else 0

        print(f"\n{Colors.BOLD}{Colors.INFO}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}Statistics:{Colors.RESET}")
        print(f"  Runtime: {runtime:.1f}s")
        print(f"  Total received: {self.stats['total_received']}")
        print(f"  Messages/sec: {msg_per_sec:.2f}")
        print(f"  Watchlisted: {self.stats['watchlisted']}")
        print(f"  Filtered out: {self.stats['filtered']}")

        if self.stats['by_type']:
            print(f"\n  By type:")
            for msg_type, count in sorted(self.stats['by_type'].items()):
                print(f"    Type {msg_type}: {count}")

        print(f"{Colors.BOLD}{Colors.INFO}{'='*80}{Colors.RESET}\n")

    def format_message(self, msg: Dict) -> str:
        msg_type = msg.get('type')

        self.stats['by_type'][msg_type] = self.stats['by_type'].get(msg_type, 0) + 1

        is_watchlisted = 'watchlist' in msg and msg['watchlist'] is not None
        if is_watchlisted:
            self.stats['watchlisted'] += 1

        if self.filter_type and msg_type != self.filter_type:
            self.stats['filtered'] += 1
            return None

        if self.filter_watchlist and not is_watchlisted:
            self.stats['filtered'] += 1
            return None

        timestamp = msg.get('timestamp', datetime.now().isoformat())
        mmsi = msg.get('mmsi', 'Unknown')

        if msg_type in (1, 2, 3, 18, 19):
            type_color = Colors.GREEN
            type_name = "POSITION"
        elif msg_type == 5:
            type_color = Colors.MAGENTA
            type_name = "STATIC"
        else:
            type_color = Colors.CYAN
            type_name = f"TYPE_{msg_type}"

        if is_watchlisted:
            watchlist_info = msg['watchlist']
            header = (f"{Colors.RED_BG}{Colors.WHITE}{Colors.BOLD} WATCHLIST "
                     f"{Colors.RESET} {type_color}[{type_name}]{Colors.RESET} "
                     f"{Colors.BOLD}MMSI: {mmsi}{Colors.RESET}")
        else:
            header = f"{type_color}[{type_name}]{Colors.RESET} {Colors.BOLD}MMSI: {mmsi}{Colors.RESET}"

        lines = [
            f"\n{Colors.DIM}{timestamp}{Colors.RESET}",
            header
        ]

        if 'lat' in msg and 'lon' in msg:
            lat = msg['lat']
            lon = msg['lon']
            if lat is not None and lon is not None:
                lines.append(f"  {Colors.CYAN}Position:{Colors.RESET} {lat:.6f}°, {lon:.6f}°")

            if 'speed' in msg and msg['speed'] is not None:
                lines.append(f"  {Colors.CYAN}Speed:{Colors.RESET} {msg['speed']:.1f} knots")

            if 'course' in msg and msg['course'] is not None:
                lines.append(f"  {Colors.CYAN}Course:{Colors.RESET} {msg['course']:.1f}°")

            if 'heading' in msg and msg['heading'] is not None:
                lines.append(f"  {Colors.CYAN}Heading:{Colors.RESET} {msg['heading']}°")

        if msg_type == 5:
            if 'name' in msg and msg['name']:
                lines.append(f"  {Colors.YELLOW}Name:{Colors.RESET} {msg['name']}")

            if 'imo' in msg and msg['imo']:
                lines.append(f"  {Colors.YELLOW}IMO:{Colors.RESET} {msg['imo']}")

            if 'callsign' in msg and msg['callsign']:
                lines.append(f"  {Colors.YELLOW}Callsign:{Colors.RESET} {msg['callsign']}")

            if 'shiptype' in msg and msg['shiptype'] is not None:
                lines.append(f"  {Colors.YELLOW}Ship Type:{Colors.RESET} {msg['shiptype']}")

            if 'length' in msg and msg['length'] is not None:
                lines.append(f"  {Colors.YELLOW}Length:{Colors.RESET} {msg['length']}m")

            if 'width' in msg and msg['width'] is not None:
                lines.append(f"  {Colors.YELLOW}Width:{Colors.RESET} {msg['width']}m")

        if is_watchlisted:
            watchlist = msg['watchlist']
            list_id = msg.get('list_id') or watchlist.get('list_id', 'Unknown')
            lines.append(f"  {Colors.RED_BG}{Colors.WHITE} WATCHLIST {Colors.RESET} "
                        f"List: {watchlist.get('list_name', 'Unknown')} "
                        f"(ID: {list_id})")

        lines.append(f"{Colors.DIM}{'-'*80}{Colors.RESET}")

        return '\n'.join(lines)

    async def connect_and_monitor(self):
        
        self.print_header()

        try:
            async with websockets.connect(self.url) as websocket:
                print(f"{Colors.SUCCESS}✓ Connected to {self.url}{Colors.RESET}\n")
                self.running = True

                while self.running:
                    try:
                        raw_message = await websocket.recv()
                        self.stats['total_received'] += 1

                        try:
                            message = json.loads(raw_message)
                        except json.JSONDecodeError as e:
                            print(f"{Colors.ERROR}✗ JSON decode error: {e}{Colors.RESET}")
                            continue

                        msg_type = message.get('type')

                        if msg_type == 'connected':
                            print(f"{Colors.SUCCESS}✓ Server says: {message.get('message')}{Colors.RESET}\n")

                        elif msg_type == 'track_update':
                            formatted = self.format_message(message)
                            if formatted:
                                print(formatted)

                        elif msg_type == 'pong':
                            print(f"{Colors.DIM}← pong{Colors.RESET}")

                        else:
                            print(f"{Colors.WARNING}? Unknown message type: {msg_type}{Colors.RESET}")
                            print(f"{Colors.DIM}{json.dumps(message, indent=2)}{Colors.RESET}\n")

                    except ConnectionClosed:
                        print(f"\n{Colors.ERROR}✗ Connection closed by server{Colors.RESET}")
                        break

                    except KeyboardInterrupt:
                        print(f"\n{Colors.WARNING}Stopping monitor...{Colors.RESET}")
                        break

        except WebSocketException as e:
            print(f"{Colors.ERROR}✗ WebSocket error: {e}{Colors.RESET}")
            return False

        except Exception as e:
            print(f"{Colors.ERROR}✗ Unexpected error: {e}{Colors.RESET}")
            import traceback
            traceback.print_exc()
            return False

        finally:
            self.running = False
            self.print_stats()

        return True

    async def run(self):
        
        try:
            await self.connect_and_monitor()
        except KeyboardInterrupt:
            print(f"\n{Colors.WARNING}Interrupted by user{Colors.RESET}")
            self.print_stats()


def main():
    
    parser = argparse.ArgumentParser(
        description='DarkFleet WebSocket Monitor - Real-time AIS message display',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s
  %(prog)s --stream watchlist
  %(prog)s --host 10.0.0.5
  %(prog)s --filter 5
  %(prog)s --filter 1
  %(prog)s --watchlist
  %(prog)s --stream watchlist
