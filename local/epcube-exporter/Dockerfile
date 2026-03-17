FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir opencv-python-headless pycryptodome numpy
COPY exporter.py .

EXPOSE 9200
CMD ["python", "-u", "exporter.py"]
