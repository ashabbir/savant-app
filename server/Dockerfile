FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV RUNNING_IN_DOCKER=1
ENV SAVANT_API_ONLY=1
ENV SAVANT_SERVER_DATA_DIR=/data/savant
ENV MCP_CONFIG=/app/mcp-config.json
ENV FLASK_HOST=0.0.0.0
ENV FLASK_PORT=8090
ENV GUNICORN_WORKERS=2
ENV GUNICORN_THREADS=4
# Explicitly set the seed directory to the target location for bootstrap
# This should point to where abilities are stored, which is /data/savant/abilities
ENV SAVANT_ABILITIES_SEED_DIR=/data/savant/abilities
# Ensure Python can find modules within /app (which includes server/)
ENV PYTHONPATH=/app

WORKDIR /app

RUN groupadd -r savant && useradd -r -g savant savant

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY mcp/requirements.txt /app/mcp/requirements.txt
RUN pip install --no-cache-dir -r /app/mcp/requirements.txt

# Copy the entire application code
COPY . /app

# Create and set permissions for data directories, ensuring writable target for abilities
# Ensure /data/savant is created and owned by savant user.
RUN mkdir -p /data/savant && chown -R savant:savant /data/savant

# Embed abilities seed data directly into the image at the target location.
# This bypasses the problematic materialization in /tmp and the expected /app/seed/abilities.
RUN mkdir -p /data/savant/abilities/personas /data/savant/abilities/rules /data/savant/abilities/policies /data/savant/abilities/repos && \
#    cp /app/server/abilities/personas/*.md /data/savant/abilities/personas/ && \
#    cp /app/server/abilities/rules/*.md /data/savant/abilities/rules/ && \
#    cp /app/server/abilities/policies/*.md /data/savant/abilities/policies/ && \
#    cp /app/server/abilities/repos/*.md /data/savant/abilities/repos/ && \
    chown -R savant:savant /data/savant/abilities

# Ensure the app code itself is owned by savant user for any runtime operations
RUN chown -R savant:savant /app

RUN chmod +x /app/docker-entrypoint.sh

USER savant

EXPOSE 8090
EXPOSE 8091
EXPOSE 8092
EXPOSE 8093
EXPOSE 8094

CMD ["/app/docker-entrypoint.sh"]
