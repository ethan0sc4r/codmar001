
import logging
import sys
from typing import Any

import structlog


class LoggerMixin:
    

    _logger_context: dict = {}

    @property
    def logger(self):
        
        return structlog.get_logger(**self._logger_context)


def configure_logging(level: str = "INFO", format_type: str = "json") -> None:
    log_level = getattr(logging, level.upper(), logging.INFO)

    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if format_type == "json":
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )


def get_logger(module: str = "collettore", **context: Any):
    return structlog.get_logger(module=module, **context)
