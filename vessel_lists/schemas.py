from pydantic import BaseModel, model_validator, field_validator, Field
from typing import Optional, List, Any, Dict
import re

MAX_NAME_LENGTH = 200
MAX_STRING_LENGTH = 500
MAX_NOTE_LENGTH = 2000
MAX_CUSTOM_DATA_KEYS = 50


def sanitize_string(value: str, max_length: int = MAX_STRING_LENGTH) -> str:
    
    if not value:
        return value
    sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)
    return sanitized[:max_length]


class VesselListBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=MAX_NAME_LENGTH)
    color: str = Field(..., max_length=20)
    custom_data: Optional[Dict[str, Any]] = None

    @field_validator('name')
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        return sanitize_string(v, MAX_NAME_LENGTH)

    @field_validator('color')
    @classmethod
    def validate_color(cls, v: str) -> str:
        v = v.strip()
        if re.match(r'^
            return v
        if re.match(r'^
            return v
        valid_colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple',
                        'pink', 'black', 'white', 'gray', 'grey', 'cyan', 'magenta']
        if v.lower() in valid_colors:
            return v.lower()
        if not v:
            return '
        return v[:20]

    @field_validator('custom_data')
    @classmethod
    def validate_custom_data(cls, v: Optional[Dict]) -> Optional[Dict]:
        if v is None:
            return v
        if len(v) > MAX_CUSTOM_DATA_KEYS:
            raise ValueError(f'custom_data cannot have more than {MAX_CUSTOM_DATA_KEYS} keys')
        return v

class VesselListCreate(VesselListBase):
    pass

class VesselListUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    custom_data: Optional[Dict[str, Any]] = None


class VesselList(VesselListBase):
    id: int
    vessel_count: int = 0

    class Config:

        from_attributes = True

class VesselBase(BaseModel):
    mmsi: Optional[str] = Field(None, max_length=20)
    imo: Optional[str] = Field(None, max_length=20)
    name: Optional[str] = Field(None, max_length=MAX_NAME_LENGTH)
    callsign: Optional[str] = Field(None, max_length=20)
    flag: Optional[str] = Field(None, max_length=50)
    lastposition: Optional[str] = Field(None, max_length=1000)
    note: Optional[str] = Field(None, max_length=MAX_NOTE_LENGTH)
    list_id: int

    @field_validator('mmsi')
    @classmethod
    def validate_mmsi(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v and not re.match(r'^\d{9}$', v):
            v = re.sub(r'[^\d]', '', v)[:9]
        return v if v else None

    @field_validator('imo')
    @classmethod
    def validate_imo(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v.startswith('IMO'):
            v = v[3:].strip()
        v = re.sub(r'[^\d]', '', v)[:7]
        return v if v else None

    @field_validator('name', 'callsign', 'flag')
    @classmethod
    def sanitize_text_fields(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return sanitize_string(v, MAX_NAME_LENGTH)

    @field_validator('note')
    @classmethod
    def sanitize_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return sanitize_string(v, MAX_NOTE_LENGTH)

    @model_validator(mode='after')
    def check_mmsi_or_imo(self):
        
        if not self.mmsi and not self.imo:
            raise ValueError('At least one of MMSI or IMO must be provided')
        return self

class VesselCreate(VesselBase):
    pass

class VesselUpdate(BaseModel):
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    name: Optional[str] = None
    callsign: Optional[str] = None
    flag: Optional[str] = None
    lastposition: Optional[str] = None
    note: Optional[str] = None


class Vessel(VesselBase):
    id: int

    class Config:
        from_attributes = True

class VesselBulkCreate(BaseModel):
    mmsi: Optional[str] = Field(None, max_length=20)
    list_ids: List[int] = Field(..., min_length=1, max_length=100)
    imo: Optional[str] = Field(None, max_length=20)
    name: Optional[str] = Field(None, max_length=MAX_NAME_LENGTH)
    callsign: Optional[str] = Field(None, max_length=20)
    flag: Optional[str] = Field(None, max_length=50)
    lastposition: Optional[str] = Field(None, max_length=1000)
    note: Optional[str] = Field(None, max_length=MAX_NOTE_LENGTH)

    @field_validator('mmsi')
    @classmethod
    def validate_mmsi(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v and not re.match(r'^\d{9}$', v):
            v = re.sub(r'[^\d]', '', v)[:9]
        return v if v else None

    @field_validator('imo')
    @classmethod
    def validate_imo(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v.startswith('IMO'):
            v = v[3:].strip()
        v = re.sub(r'[^\d]', '', v)[:7]
        return v if v else None

    @model_validator(mode='after')
    def check_mmsi_or_imo(self):
        
        if not self.mmsi and not self.imo:
            raise ValueError('At least one of MMSI or IMO must be provided')
        return self

class VesselDocumentBase(BaseModel):
    mmsi: str = Field(..., min_length=1, max_length=20)
    json_data: dict = Field(...)

    @field_validator('mmsi')
    @classmethod
    def validate_mmsi(cls, v: str) -> str:
        v = v.strip()
        v = re.sub(r'[^\d]', '', v)[:9]
        if not v:
            raise ValueError('MMSI is required')
        return v

    @field_validator('json_data')
    @classmethod
    def validate_json_data(cls, v: dict) -> dict:
        if len(v) > MAX_CUSTOM_DATA_KEYS:
            raise ValueError(f'json_data cannot have more than {MAX_CUSTOM_DATA_KEYS} keys')
        return v


class VesselDocumentCreate(VesselDocumentBase):
    pass


class VesselDocumentUpdate(BaseModel):
    json_data: dict = Field(...)

    @field_validator('json_data')
    @classmethod
    def validate_json_data(cls, v: dict) -> dict:
        if len(v) > MAX_CUSTOM_DATA_KEYS:
            raise ValueError(f'json_data cannot have more than {MAX_CUSTOM_DATA_KEYS} keys')
        return v

class VesselDocument(VesselDocumentBase):
    id: int
    timestamp: str

    class Config:
        from_attributes = True
