
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from src.modules.config_ui import router as config_router
from src.core.logger import configure_logging, get_logger

load_dotenv()

configure_logging(level="INFO", format_type="pretty")

logger = get_logger(module="config-ui-server")

app = FastAPI(title="DarkFleet Configuration UI", version="1.0.0")

app.include_router(config_router)

static_path = Path(__file__).parent / "modules" / "config_ui" / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


@app.get("/")
async def root():
    
    html_path = static_path / "config-ui.html"
    if html_path.exists():
        return FileResponse(html_path)
    return {"error": "Config UI not found"}


@app.get("/config-ui.js")
async def serve_js():
    
    js_path = static_path / "config-ui.js"
    if js_path.exists():
        return FileResponse(js_path, media_type="application/javascript")
    return {"error": "JavaScript not found"}


@app.get("/favicon.ico")
async def favicon():
    
    return FileResponse(static_path / "config-ui.html", status_code=204)


def main():
    
    logger.info("Starting Configuration UI server")
    logger.info("Open browser at: http://localhost:3000")

    uvicorn.run(
        "src.config_ui_server:app",
        host="0.0.0.0",
        port=3000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
