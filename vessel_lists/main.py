from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional

from models import Base
import models, schemas, database
from config import config
from security import (
    SecurityHeadersMiddleware,
    rate_limiter,
    audit_log,
    get_client_ip
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s'
)
logger = logging.getLogger("vessel_lists")

models.Base.metadata.create_all(bind=database.engine)

from ais_websocket import ais_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    
    logger.info("Vessel Lists Manager starting...")
    logger.info(f"CORS origins: {config.cors.allowed_origins}")
    yield
    logger.info("Shutting down AIS WebSocket client...")
    await ais_client.stop()


tags_metadata = [
    {"name": "Lists", "description": "Operations with vessel lists"},
    {"name": "Vessels", "description": "Manage vessels within lists"},
    {"name": "Analytics", "description": "Statistics and export operations"},
    {"name": "Conflicts", "description": "Detect data conflicts"},
    {"name": "AIS", "description": "AIS WebSocket connection and live updates"},
]

app = FastAPI(
    title="Vessel Lists Manager API",
    description="Comprehensive API for managing maritime vessel lists with conflict detection and live AIS updates",
    version="2.2.0",
    openapi_tags=tags_metadata,
    lifespan=lifespan,
)

app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors.allowed_origins,
    allow_credentials=config.cors.allow_credentials,
    allow_methods=config.cors.allowed_methods,
    allow_headers=config.cors.allowed_headers,
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    
    client_ip = get_client_ip(request)

    if not rate_limiter.is_allowed(client_ip, config.rate_limit.requests_per_minute):
        audit_log("RATE_LIMITED", "request", details={"path": request.url.path}, request=request)
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please try again later."}
        )

    return await call_next(request)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    
    logger.exception(f"Unhandled exception on {request.url.path}")

    if config.server.debug:
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc), "type": type(exc).__name__}
        )

    return JSONResponse(
        status_code=500,
        content={"detail": "An internal error occurred. Please try again later."}
    )

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

assets_dir = os.path.join(static_dir, "assets")
if not os.path.exists(assets_dir):
    os.makedirs(assets_dir)
app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

@app.get("/ui")
async def read_index():
    return FileResponse(os.path.join(static_dir, 'index.html'))

from fastapi import Request
from fastapi.responses import RedirectResponse

@app.get("/")
async def root():
    return RedirectResponse(url="/ui")

def with_vessel_count(vessel_list):
    vessel_list.vessel_count = len(vessel_list.vessels)
    return vessel_list

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

from analytics import router as analytics_router
app.include_router(analytics_router, prefix="/analytics")

from documents import router as documents_router
app.include_router(documents_router, prefix="/documents")

from ais_router import router as ais_router
app.include_router(ais_router, prefix="/ais")


@app.post("/lists/", response_model=schemas.VesselList)
def create_list(vessel_list: schemas.VesselListCreate, db: Session = Depends(get_db)):
    db_list = models.VesselList(
        name=vessel_list.name, 
        color=vessel_list.color, 
        custom_data=vessel_list.custom_data
    )
    db.add(db_list)
    db.commit()
    db.refresh(db_list)
    return with_vessel_count(db_list)

@app.get("/lists/", response_model=List[schemas.VesselList])
def read_lists(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    lists = db.query(models.VesselList).offset(skip).limit(limit).all()
    for l in lists:
        l.vessel_count = len(l.vessels)
    return lists

@app.get("/lists/{list_id}", response_model=schemas.VesselList)
def read_list(list_id: int, db: Session = Depends(get_db)):
    vessel_list = db.query(models.VesselList).filter(models.VesselList.id == list_id).first()
    if vessel_list is None:
        raise HTTPException(status_code=404, detail="List not found")
    return vessel_list

@app.delete("/lists/{list_id}")
def delete_list(list_id: int, db: Session = Depends(get_db)):
    vessel_list = db.query(models.VesselList).filter(models.VesselList.id == list_id).first()
    if vessel_list is None:
        raise HTTPException(status_code=404, detail="List not found")
    db.delete(vessel_list)
    db.commit()
    return {"ok": True}

@app.put("/lists/{list_id}", response_model=schemas.VesselList)
def update_list(list_id: int, list_update: schemas.VesselListUpdate, db: Session = Depends(get_db)):
    db_list = db.query(models.VesselList).filter(models.VesselList.id == list_id).first()
    if db_list is None:
        raise HTTPException(status_code=404, detail="List not found")
    
    if list_update.name is not None:
        db_list.name = list_update.name
    if list_update.color is not None:
        db_list.color = list_update.color
    if list_update.custom_data is not None:
        db_list.custom_data = list_update.custom_data

    db.commit()
    db.refresh(db_list)
    return with_vessel_count(db_list)




@app.get("/vessels/conflicts")
def detect_conflicts(db: Session = Depends(get_db)):
    
    vessels = db.query(models.Vessel).join(models.VesselList).all()
    
    mmsi_map = {}
    imo_map = {}
    mmsi_imo_pairs = {}
    
    for vessel in vessels:
        list_info = {
            "list_id": vessel.list_id,
            "list_name": vessel.vessel_list.name,
            "list_color": vessel.vessel_list.color
        }
        vessel_info = (vessel, list_info)
        
        if vessel.mmsi:
            if vessel.mmsi not in mmsi_map:
                mmsi_map[vessel.mmsi] = []
            mmsi_map[vessel.mmsi].append(vessel_info)
            
            if vessel.mmsi not in mmsi_imo_pairs:
                mmsi_imo_pairs[vessel.mmsi] = {}
            imo_val = vessel.imo or "NULL"
            if imo_val not in mmsi_imo_pairs[vessel.mmsi]:
                mmsi_imo_pairs[vessel.mmsi][imo_val] = []
            mmsi_imo_pairs[vessel.mmsi][imo_val].append(vessel_info)
        
        if vessel.imo:
            if vessel.imo not in imo_map:
                imo_map[vessel.imo] = []
            imo_map[vessel.imo].append(vessel_info)
    
    conflicts = {
        "mmsi_duplicates": [],
        "imo_duplicates": [],
        "mmsi_imo_inconsistencies": []
    }
    
    for mmsi, occurrences in mmsi_map.items():
        unique_lists = set(occ[1]["list_id"] for occ in occurrences)
        if len(unique_lists) > 1:
            conflicts["mmsi_duplicates"].append({
                "mmsi": mmsi,
                "count": len(occurrences),
                "lists": [occ[1] for occ in occurrences],
                "vessels": [{
                    "id": occ[0].id,
                    "mmsi": occ[0].mmsi,
                    "imo": occ[0].imo,
                    "list_id": occ[1]["list_id"],
                    "list_name": occ[1]["list_name"],
                    "list_color": occ[1]["list_color"]
                } for occ in occurrences]
            })
    
    for imo, occurrences in imo_map.items():
        unique_lists = set(occ[1]["list_id"] for occ in occurrences)
        if len(unique_lists) > 1:
            conflicts["imo_duplicates"].append({
                "imo": imo,
                "count": len(occurrences),
                "lists": [occ[1] for occ in occurrences],
                "vessels": [{
                    "id": occ[0].id,
                    "mmsi": occ[0].mmsi,
                    "imo": occ[0].imo,
                    "list_id": occ[1]["list_id"],
                    "list_name": occ[1]["list_name"],
                    "list_color": occ[1]["list_color"]
                } for occ in occurrences]
            })
    
    for mmsi, imo_groups in mmsi_imo_pairs.items():
        if len(imo_groups) > 1:
            conflicts["mmsi_imo_inconsistencies"].append({
                "type": "mmsi_multiple_imos",
                "mmsi": mmsi,
                "imos": list(imo_groups.keys()),
                "vessels": [{
                    "id": occ[0].id,
                    "mmsi": occ[0].mmsi,
                    "imo": occ[0].imo,
                    "list_id": occ[1]["list_id"],
                    "list_name": occ[1]["list_name"],
                    "list_color": occ[1]["list_color"]
                } for imo_val, occs in imo_groups.items() for occ in occs]
            })
    
    total = (len(conflicts["mmsi_duplicates"]) + 
             len(conflicts["imo_duplicates"]) + 
             len(conflicts["mmsi_imo_inconsistencies"]))
    
    return {
        "total_conflicts": total,
        "conflicts": conflicts
    }

@app.get("/vessels/all")
def get_all_vessels(db: Session = Depends(get_db)):
    
    vessels = db.query(models.Vessel).join(models.VesselList).all()
    
    formatted_results = []
    for vessel in vessels:
        formatted_results.append({
            "id": vessel.id,
            "mmsi": vessel.mmsi,
            "imo": vessel.imo,
            "list_id": vessel.list_id,
            "list_name": vessel.vessel_list.name,
            "list_color": vessel.vessel_list.color
        })
    
    return formatted_results

@app.get("/vessels/search")
def search_vessels(q: str = Query(..., min_length=1, description="Search query for MMSI or IMO"), db: Session = Depends(get_db)):
    
    query = db.query(models.Vessel).join(models.VesselList).filter(
        (models.Vessel.mmsi.contains(q)) | (models.Vessel.imo.contains(q))
    )
    results = query.all()
    
    formatted_results = []
    for vessel in results:
        formatted_results.append({
            "id": vessel.id,
            "mmsi": vessel.mmsi,
            "imo": vessel.imo,
            "list_id": vessel.list_id,
            "list_name": vessel.vessel_list.name,
            "list_color": vessel.vessel_list.color
        })
    
    return formatted_results

@app.post("/vessels/", response_model=schemas.Vessel)
def create_vessel(vessel: schemas.VesselCreate, db: Session = Depends(get_db)):
    db_list = db.query(models.VesselList).filter(models.VesselList.id == vessel.list_id).first()
    if not db_list:
        raise HTTPException(status_code=404, detail="Vessel List not found")

    db_vessel = models.Vessel(
        mmsi=vessel.mmsi,
        imo=vessel.imo,
        name=vessel.name,
        callsign=vessel.callsign,
        flag=vessel.flag,
        lastposition=vessel.lastposition,
        note=vessel.note,
        list_id=vessel.list_id
    )
    db.add(db_vessel)
    db.commit()
    db.refresh(db_vessel)
    return db_vessel

@app.post("/vessels/bulk")
def create_vessel_bulk(bulk_data: schemas.VesselBulkCreate, db: Session = Depends(get_db)):
    
    created_vessels = []

    for list_id in bulk_data.list_ids:
        db_list = db.query(models.VesselList).filter(models.VesselList.id == list_id).first()
        if not db_list:
            continue

        db_vessel = models.Vessel(
            mmsi=bulk_data.mmsi,
            imo=bulk_data.imo,
            name=bulk_data.name,
            callsign=bulk_data.callsign,
            flag=bulk_data.flag,
            lastposition=bulk_data.lastposition,
            note=bulk_data.note,
            list_id=list_id
        )
        db.add(db_vessel)
        created_vessels.append({
            "id": db_vessel.id,
            "list_name": db_list.name,
            "list_id": list_id
        })

    db.commit()
    return {"created": len(created_vessels), "vessels": created_vessels}

@app.get("/vessels/", response_model=List[schemas.Vessel])
def read_vessels(
    list_id: Optional[int] = Query(None, description="Filter by list ID"),
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db)
):
    query = db.query(models.Vessel)
    if list_id:
        query = query.filter(models.Vessel.list_id == list_id)
    return query.offset(skip).limit(limit).all()

@app.get("/vessels/{vessel_id}", response_model=schemas.Vessel)
def read_vessel(vessel_id: int, db: Session = Depends(get_db)):
    vessel = db.query(models.Vessel).filter(models.Vessel.id == vessel_id).first()
    if vessel is None:
        raise HTTPException(status_code=404, detail="Vessel not found")
    return vessel

@app.delete("/vessels/{vessel_id}")
def delete_vessel(vessel_id: int, db: Session = Depends(get_db)):
    vessel = db.query(models.Vessel).filter(models.Vessel.id == vessel_id).first()
    if vessel is None:
        raise HTTPException(status_code=404, detail="Vessel not found")
    db.delete(vessel)
    db.commit()
    return {"ok": True}

@app.put("/vessels/{vessel_id}", response_model=schemas.Vessel)
def update_vessel(vessel_id: int, vessel_update: schemas.VesselUpdate, db: Session = Depends(get_db)):
    db_vessel = db.query(models.Vessel).filter(models.Vessel.id == vessel_id).first()
    if db_vessel is None:
        raise HTTPException(status_code=404, detail="Vessel not found")

    if vessel_update.mmsi is not None:
        db_vessel.mmsi = vessel_update.mmsi
    if vessel_update.imo is not None:
        db_vessel.imo = vessel_update.imo
    if vessel_update.name is not None:
        db_vessel.name = vessel_update.name
    if vessel_update.callsign is not None:
        db_vessel.callsign = vessel_update.callsign
    if vessel_update.flag is not None:
        db_vessel.flag = vessel_update.flag
    if vessel_update.lastposition is not None:
        db_vessel.lastposition = vessel_update.lastposition
    if vessel_update.note is not None:
        db_vessel.note = vessel_update.note

    db.commit()
    db.refresh(db_vessel)
    return db_vessel

@app.put("/vessels/update-by-imo/{imo}")
def update_vessel_by_imo(imo: str, vessel_update: schemas.VesselUpdate, db: Session = Depends(get_db)):
    vessels = db.query(models.Vessel).filter(models.Vessel.imo == imo).all()

    if not vessels:
        raise HTTPException(status_code=404, detail=f"No vessels found with IMO {imo}")

    updated_count = 0
    for db_vessel in vessels:
        changed = False

        if vessel_update.mmsi is not None and db_vessel.mmsi != vessel_update.mmsi:
            db_vessel.mmsi = vessel_update.mmsi
            changed = True
        if vessel_update.name is not None and db_vessel.name != vessel_update.name:
            db_vessel.name = vessel_update.name
            changed = True
        if vessel_update.callsign is not None and db_vessel.callsign != vessel_update.callsign:
            db_vessel.callsign = vessel_update.callsign
            changed = True
        if vessel_update.flag is not None and db_vessel.flag != vessel_update.flag:
            db_vessel.flag = vessel_update.flag
            changed = True
        if vessel_update.lastposition is not None:
            db_vessel.lastposition = vessel_update.lastposition
            changed = True
        if vessel_update.note is not None and db_vessel.note != vessel_update.note:
            db_vessel.note = vessel_update.note
            changed = True

        if changed:
            updated_count += 1

    db.commit()

    return {
        "imo": imo,
        "found": len(vessels),
        "updated": updated_count
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=config.server.host,
        port=config.server.port,
        log_level="info"
    )

