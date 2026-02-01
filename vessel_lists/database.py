import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import config

if not os.path.exists("data"):
    os.makedirs("data")

SQLALCHEMY_DATABASE_URL = config.database.url

connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    echo=config.database.echo
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
