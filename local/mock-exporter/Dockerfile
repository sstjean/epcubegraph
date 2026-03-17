FROM python:3.12-alpine
WORKDIR /app
COPY metrics_server.py .
EXPOSE 9191
CMD ["python", "-u", "metrics_server.py"]
