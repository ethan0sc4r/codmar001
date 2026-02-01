from fastapi import APIRouter, Depends, Response, Query, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import csv
import io

import models, schemas, database
from security import sanitize_filename, audit_log

router = APIRouter()

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/export/list/{list_id}", tags=["Analytics"])
def export_list_csv(list_id: int, request: Request, db: Session = Depends(get_db)):
    
    vessel_list = db.query(models.VesselList).filter(models.VesselList.id == list_id).first()
    if not vessel_list:
        raise HTTPException(status_code=404, detail="List not found")

    vessels = db.query(models.Vessel).filter(models.Vessel.list_id == list_id).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['MMSI', 'IMO', 'Name', 'Flag', 'LastPosition', 'Note'])

    for vessel in vessels:
        writer.writerow([
            vessel.mmsi,
            vessel.imo or '',
            vessel.name or '',
            vessel.flag or '',
            vessel.lastposition or '',
            vessel.note or ''
        ])

    csv_data = output.getvalue()
    output.close()

    safe_filename = sanitize_filename(vessel_list.name)

    audit_log("EXPORT", "vessel_list", list_id,
              {"format": "csv", "vessel_count": len(vessels)}, request)

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={safe_filename}.csv"
        }
    )


@router.get("/stats", tags=["Analytics"])
def get_stats(db: Session = Depends(get_db)):
    
    
    total_lists = db.query(func.count(models.VesselList.id)).scalar()
    total_vessels = db.query(func.count(models.Vessel.id)).scalar()
    
    vessels_per_list = db.query(
        models.VesselList.name,
        models.VesselList.color,
        func.count(models.Vessel.id).label('count')
    ).outerjoin(models.Vessel).group_by(models.VesselList.id).all()
    
    flags = db.query(
        models.Vessel.flag,
        func.count(models.Vessel.id).label('count')
    ).filter(models.Vessel.flag.isnot(None)).group_by(models.Vessel.flag).all()
    
    with_imo = db.query(func.count(models.Vessel.id)).filter(models.Vessel.imo.isnot(None)).scalar()
    without_imo = total_vessels - with_imo
    
    with_position = db.query(func.count(models.Vessel.id)).filter(models.Vessel.lastposition.isnot(None)).scalar()
    
    return {
        "overview": {
            "total_lists": total_lists,
            "total_vessels": total_vessels,
            "unique_flags": len(flags),
            "with_imo": with_imo,
            "without_imo": without_imo,
            "with_position": with_position
        },
        "lists": [
            {
                "name": name,
                "color": color,
                "vessel_count": count
            }
            for name, color, count in vessels_per_list
        ],
        "flags": [
            {
                "flag": flag,
                "count": count
            }
            for flag, count in flags
        ]
    }


@router.get("/vessels/advanced-search", tags=["Vessels"])
def advanced_search(
    mmsi: Optional[str] = Query(None, description="Search by MMSI (partial match)"),
    imo: Optional[str] = Query(None, description="Search by IMO (partial match)"),
    name: Optional[str] = Query(None, description="Search by vessel name (partial match)"),
    flag: Optional[str] = Query(None, description="Filter by flag (exact match)"),
    list_id: Optional[int] = Query(None, description="Filter by list ID"),
    has_imo: Optional[bool] = Query(None, description="Filter vessels with/without IMO"),
    has_position: Optional[bool] = Query(None, description="Filter vessels with/without position"),
    db: Session = Depends(get_db)
):
    query = db.query(models.Vessel).join(models.VesselList)
    
    if mmsi:
        query = query.filter(models.Vessel.mmsi.contains(mmsi))
    if imo:
        query = query.filter(models.Vessel.imo.contains(imo))
    if name:
        query = query.filter(models.Vessel.name.contains(name))
    if flag:
        query = query.filter(models.Vessel.flag == flag)
    if list_id:
        query = query.filter(models.Vessel.list_id == list_id)
    if has_imo is not None:
        if has_imo:
            query = query.filter(models.Vessel.imo.isnot(None))
        else:
            query = query.filter(models.Vessel.imo.is_(None))
    if has_position is not None:
        if has_position:
            query = query.filter(models.Vessel.lastposition.isnot(None))
        else:
            query = query.filter(models.Vessel.lastposition.is_(None))
    
    results = query.all()
    
    return [
        {
            "id": vessel.id,
            "mmsi": vessel.mmsi,
            "imo": vessel.imo,
            "name": vessel.name,
            "flag": vessel.flag,
            "lastposition": vessel.lastposition,
            "note": vessel.note,
            "list_id": vessel.list_id,
            "list_name": vessel.vessel_list.name,
            "list_color": vessel.vessel_list.color
        }
        for vessel in results
    ]


@router.get("/filters/flags", tags=["Analytics"])
def get_available_flags(db: Session = Depends(get_db)):
    
    flags = db.query(models.Vessel.flag).filter(
        models.Vessel.flag.isnot(None)
    ).distinct().all()
    return [f[0] for f in flags]

@router.get("/filters/lists", tags=["Analytics"])
def get_lists_summary(db: Session = Depends(get_db)):
    
    lists = db.query(models.VesselList).all()
    return [
        {
            "id": l.id,
            "name": l.name,
            "color": l.color,
            "vessel_count": len(l.vessels)
        }
        for l in lists
    ]


@router.get("/vessels/aggregated", tags=["Analytics"])
def get_aggregated_vessels(db: Session = Depends(get_db)):
    all_vessels = db.query(models.Vessel).join(models.VesselList).all()
    
    vessel_groups = {}
    
    for vessel in all_vessels:
        key = vessel.mmsi if vessel.mmsi else f"imo_{vessel.imo}"
        
        if key not in vessel_groups:
            vessel_groups[key] = {
                "mmsi": vessel.mmsi,
                "imo": vessel.imo,
                "name": vessel.name,
                "flag": vessel.flag,
                "lastposition": vessel.lastposition,
                "note": vessel.note,
                "lists": [],
                "list_count": 0
            }
        
        vessel_groups[key]["lists"].append({
            "list_id": vessel.vessel_list.id,
            "list_name": vessel.vessel_list.name,
            "list_color": vessel.vessel_list.color,
            "vessel_id": vessel.id
        })
        vessel_groups[key]["list_count"] = len(vessel_groups[key]["lists"])
    
    result = sorted(vessel_groups.values(), key=lambda x: x["list_count"], reverse=True)
    
    return {
        "total_unique_vessels": len(result),
        "vessels": result
    }

@router.get("/export/aggregated", tags=["Analytics"])
def export_aggregated_csv(request: Request, db: Session = Depends(get_db)):
    
    data = get_aggregated_vessels(db)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['MMSI', 'IMO', 'Name', 'Flag', 'Lists', 'List Count', 'List Names'])

    for vessel in data["vessels"]:
        list_names = ', '.join([l['list_name'] for l in vessel['lists']])
        writer.writerow([
            vessel['mmsi'] or '',
            vessel['imo'] or '',
            vessel['name'] or '',
            vessel['flag'] or '',
            vessel['list_count'],
            vessel['list_count'],
            list_names
        ])

    csv_data = output.getvalue()
    output.close()

    audit_log("EXPORT", "aggregated_vessels", None,
              {"format": "csv", "vessel_count": data["total_unique_vessels"]}, request)

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=aggregated_vessels.csv"
        }
    )
