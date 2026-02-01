from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List
import json
import csv
import io

import models, schemas, database

router = APIRouter()

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/", response_model=schemas.VesselDocument, tags=["Documents"])
def create_document(document: schemas.VesselDocumentCreate, db: Session = Depends(get_db)):
    
    db_document = models.VesselDocument(
        mmsi=document.mmsi,
        json_data=json.dumps(document.json_data)
    )
    db.add(db_document)
    db.commit()
    db.refresh(db_document)
    
    return {
        "id": db_document.id,
        "mmsi": db_document.mmsi,
        "timestamp": db_document.timestamp.isoformat(),
        "json_data": json.loads(db_document.json_data)
    }

@router.get("/", tags=["Documents"])
def get_documents(
    mmsi: str = Query(..., description="MMSI to filter documents"),
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    db: Session = Depends(get_db)
):
    
    total = db.query(func.count(models.VesselDocument.id)).filter(
        models.VesselDocument.mmsi == mmsi
    ).scalar()
    
    documents = db.query(models.VesselDocument).filter(
        models.VesselDocument.mmsi == mmsi
    ).order_by(desc(models.VesselDocument.timestamp)).offset(
        (page - 1) * size
    ).limit(size).all()
    
    return {
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size,
        "documents": [
            {
                "id": doc.id,
                "mmsi": doc.mmsi,
                "timestamp": doc.timestamp.isoformat(),
                "json_data": json.loads(doc.json_data),
                "preview": {k: v for k, v in list(json.loads(doc.json_data).items())[:4]}
            }
            for doc in documents
        ]
    }

@router.get("/{document_id}", response_model=schemas.VesselDocument, tags=["Documents"])
def get_document(document_id: int, db: Session = Depends(get_db)):
    
    document = db.query(models.VesselDocument).filter(
        models.VesselDocument.id == document_id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "id": document.id,
        "mmsi": document.mmsi,
        "timestamp": document.timestamp.isoformat(),
        "json_data": json.loads(document.json_data)
    }

@router.put("/{document_id}", response_model=schemas.VesselDocument, tags=["Documents"])
def update_document(
    document_id: int,
    document_update: schemas.VesselDocumentUpdate,
    db: Session = Depends(get_db)
):
    
    db_document = db.query(models.VesselDocument).filter(
        models.VesselDocument.id == document_id
    ).first()
    
    if not db_document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    db_document.json_data = json.dumps(document_update.json_data)
    db.commit()
    db.refresh(db_document)
    
    return {
        "id": db_document.id,
        "mmsi": db_document.mmsi,
        "timestamp": db_document.timestamp.isoformat(),
        "json_data": json.loads(db_document.json_data)
    }

@router.delete("/{document_id}", tags=["Documents"])
def delete_document(document_id: int, db: Session = Depends(get_db)):
    
    db_document = db.query(models.VesselDocument).filter(
        models.VesselDocument.id == document_id
    ).first()
    
    if not db_document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    db.delete(db_document)
    db.commit()
    
    return {"message": "Document deleted successfully", "id": document_id}


@router.get("/count/{mmsi}", tags=["Documents"])
def count_documents(mmsi: str, db: Session = Depends(get_db)):
    
    count = db.query(func.count(models.VesselDocument.id)).filter(
        models.VesselDocument.mmsi == mmsi
    ).scalar()
    
    return {"mmsi": mmsi, "count": count}

@router.get("/export/{document_id}", tags=["Documents"])
def export_document(
    document_id: int,
    format: str = Query("json", regex="^(json|csv)$"),
    db: Session = Depends(get_db)
):
    
    document = db.query(models.VesselDocument).filter(
        models.VesselDocument.id == document_id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    json_data = json.loads(document.json_data)
    
    if format == "json":
        return Response(
            content=json.dumps({
                "mmsi": document.mmsi,
                "timestamp": document.timestamp.isoformat(),
                "data": json_data
            }, indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename=document_{document_id}.json"
            }
        )
    else:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Key', 'Value'])
        
        for key, value in json_data.items():
            writer.writerow([key, str(value)])
        
        csv_data = output.getvalue()
        output.close()
        
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=document_{document_id}.csv"
            }
        )
