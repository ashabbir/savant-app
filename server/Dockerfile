FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8090

CMD ["gunicorn", "--bind", "0.0.0.0:8090", "--workers", "1", "--threads", "4", "--timeout", "30", "--reload", "--reload-extra-file", "/app/templates/detail.html", "--reload-extra-file", "/app/templates/index.html", "app:app"]
