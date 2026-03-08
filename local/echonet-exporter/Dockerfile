# syntax=docker/dockerfile:1
# echonet-exporter: Multi-arch Dockerfile using Go cross-compilation
# Builds for AMD64 (NAS) and ARM64 (Raspberry Pi)
# Source: https://github.com/styygeli/echonet-exporter

FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS build

ARG TARGETOS
ARG TARGETARCH

RUN apk add --no-cache git

WORKDIR /src

# Clone echonet-exporter source pinned to a known-good commit
# Update this hash when upgrading to a newer version
ARG ECHONET_EXPORTER_COMMIT=92f5c7add0ae9bc53438dca00a60323868c16725
RUN git clone https://github.com/styygeli/echonet-exporter.git . \
    && git checkout ${ECHONET_EXPORTER_COMMIT}

# Download dependencies (cache layer)
RUN go mod download

# Build static binary with cross-compilation
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /echonet-exporter ./cmd/echonet-exporter

# Runtime stage — minimal Alpine image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

COPY --from=build /echonet-exporter /usr/local/bin/echonet-exporter

EXPOSE 9191

ENTRYPOINT ["echonet-exporter"]
