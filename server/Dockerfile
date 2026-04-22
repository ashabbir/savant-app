FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUNNING_IN_DOCKER=1 \
    SAVANT_API_ONLY=1 \
    SAVANT_SERVER_DATA_DIR=/data/savant \
    MCP_CONFIG=/app/mcp-config.json \
    FLASK_HOST=0.0.0.0 \
    FLASK_PORT=8090 \
    GUNICORN_WORKERS=2 \
    GUNICORN_THREADS=4

WORKDIR /app

RUN groupadd -r savant && useradd -r -g savant savant

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app
RUN pip install --no-cache-dir -r /app/mcp/requirements.txt
RUN mkdir -p /data/savant && chown -R savant:savant /app /data/savant
RUN chmod +x /app/docker-entrypoint.sh

USER savant

EXPOSE 8090
EXPOSE 8091
EXPOSE 8092
EXPOSE 8093
EXPOSE 8094

CMD ["/app/docker-entrypoint.sh"]
