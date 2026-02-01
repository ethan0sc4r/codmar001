
import sys
from typing import Any, Dict, Optional

import structlog
from structlog.typing import EventDict, WrappedLogger


def add_app_context(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    
    event_dict['app'] = 'darkfleet-server'
    return event_dict


def configure_logging(level: str = "INFO", format_type: str = "json") -> None:
    level_map = {
        "TRACE": "DEBUG",
        "DEBUG": "DEBUG",
        "INFO": "INFO",
        "WARN": "WARNING",
        "WARNING": "WARNING",
        "ERROR": "ERROR",
        "FATAL": "CRITICAL",
        "CRITICAL": "CRITICAL",
    }

    stdlib_level = level_map.get(level.upper(), "INFO")

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        add_app_context,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
    ]

    if format_type == "pretty":
        processors = shared_processors + [
            structlog.processors.ExceptionPrettyPrinter(),
            structlog.dev.ConsoleRenderer(colors=True),
        ]
    else:
        processors = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    import logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, stdlib_level),
    )


def get_logger(module: Optional[str] = None, **context: Any) -> structlog.stdlib.BoundLogger:
    if module:
        context['module'] = module

    logger = structlog.get_logger()

    if context:
        logger = logger.bind(**context)

    return logger


class LoggerMixin:

    _logger_context: Dict[str, Any] = {}

    @property
    def logger(self) -> structlog.stdlib.BoundLogger:
        
        context = {'class': self.__class__.__name__}
        context.update(self._logger_context)
        return get_logger(**context)
