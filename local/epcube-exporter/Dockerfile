FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir --root-user-action=ignore opencv-python-headless pycryptodome numpy PyJWT[crypto]
COPY exporter.py .

EXPOSE 9200
CMD ["python", "-u", "exporter.py"]
