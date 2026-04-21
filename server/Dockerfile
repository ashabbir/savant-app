FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUNNING_IN_DOCKER=1 \
    SAVANT_API_ONLY=1 \
    SAVANT_SERVER_DATA_DIR=/data/savant \
    FLASK_HOST=0.0.0.0 \
    FLASK_PORT=8090 \
    GUNICORN_WORKERS=2 \
    GUNICORN_THREADS=4

WORKDIR /app

RUN groupadd -r savant && useradd -r -g savant savant

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app
RUN mkdir -p /data/savant && chown -R savant:savant /app /data/savant

USER savant

EXPOSE 8090

CMD ["sh", "-c", "gunicorn --bind ${FLASK_HOST}:${FLASK_PORT} --workers ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} --timeout 60 app:app"]
