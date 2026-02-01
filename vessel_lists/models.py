from sqlalchemy import Column, Integer, String, ForeignKey, JSON, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class VesselList(Base):
    __tablename__ = "vessel_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    color = Column(String)
    custom_data = Column(JSON, nullable=True)

    vessels = relationship("Vessel", back_populates="vessel_list", cascade="all, delete-orphan")

class Vessel(Base):
    __tablename__ = "vessels"

    id = Column(Integer, primary_key=True, index=True)
    mmsi = Column(String, nullable=True, index=True)
    imo = Column(String, nullable=True, index=True)
    name = Column(String, nullable=True)
    callsign = Column(String, nullable=True)
    flag = Column(String, nullable=True)
    lastposition = Column(String, nullable=True)
    note = Column(String, nullable=True)
    list_id = Column(Integer, ForeignKey("vessel_lists.id"))

    vessel_list = relationship("VesselList", back_populates="vessels")

class VesselDocument(Base):
    __tablename__ = "vessel_documents"

    id = Column(Integer, primary_key=True, index=True)
    mmsi = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    json_data = Column(String, nullable=False)

    def __repr__(self):
        return f"<VesselDocument(mmsi={self.mmsi}, timestamp={self.timestamp})>"
