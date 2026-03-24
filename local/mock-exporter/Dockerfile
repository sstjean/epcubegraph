FROM python:3.12-alpine
WORKDIR /app
RUN pip install --no-cache-dir --root-user-action=ignore psycopg2-binary
COPY metrics_server.py .
EXPOSE 9191
CMD ["python", "-u", "metrics_server.py"]
