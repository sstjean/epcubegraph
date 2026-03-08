FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy build properties and project file first for layer caching
COPY Directory.Build.props ./
COPY src/EpCubeGraph.Api/EpCubeGraph.Api.csproj src/EpCubeGraph.Api/
RUN dotnet restore src/EpCubeGraph.Api/EpCubeGraph.Api.csproj --runtime linux-x64

# Copy source and build
COPY src/ src/
RUN dotnet publish src/EpCubeGraph.Api/EpCubeGraph.Api.csproj \
    --configuration Release \
    --runtime linux-x64 \
    --no-self-contained \
    --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=build /app/publish .

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "EpCubeGraph.Api.dll"]
