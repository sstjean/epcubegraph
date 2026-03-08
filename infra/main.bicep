// EP Cube Graph — Main Infrastructure Template
// Deploys Container Apps environment with VictoriaMetrics, vmauth, and API service

targetScope = 'resourceGroup'

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment name prefix for resources')
param environmentName string

@description('Key Vault name')
param keyVaultName string

@description('VictoriaMetrics container image')
param victoriaMetricsImage string

@description('vmauth container image')
param vmauthImage string

@description('API container image (leave empty for initial deploy)')
param apiImage string = ''

@description('Entra ID tenant ID for API authentication')
param entraIdTenantId string

@description('Entra ID client/app ID for API authentication')
param entraIdClientId string

@description('Remote-write bearer token')
@secure()
param remoteWriteToken string = ''

// ── Managed Identity ──
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${environmentName}-identity'
  location: location
}

// ── Key Vault (module) ──
module keyVault 'keyvault.bicep' = {
  name: 'keyVaultDeploy'
  params: {
    keyVaultName: keyVaultName
    location: location
    managedIdentityPrincipalId: managedIdentity.properties.principalId
    remoteWriteToken: remoteWriteToken
  }
}

// ── Log Analytics Workspace ──
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ── Container Apps Environment ──
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${environmentName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ── Persistent Storage for VictoriaMetrics ──
resource vmStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: containerAppsEnv
  name: 'vmstorage'
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: vmFileShare.name
      accessMode: 'ReadWrite'
    }
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: replace('${environmentName}sa', '-', '')
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource vmFileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'victoria-metrics-data'
  properties: {
    shareQuota: 50 // GB
  }
}

// ── VictoriaMetrics + vmauth Container App ──
resource vmContainerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${environmentName}-vm'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8427 // vmauth port
        transport: 'http'
      }
      secrets: [
        {
          name: 'remote-write-token'
          value: remoteWriteToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'victoria-metrics'
          image: victoriaMetricsImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          args: [
            '-retentionPeriod=5y'
            '-dedup.minScrapeInterval=1m'
            '-storageDataPath=/victoria-metrics-data'
            '-httpListenAddr=:8428'
          ]
          volumeMounts: [
            {
              volumeName: 'vm-data'
              mountPath: '/victoria-metrics-data'
            }
          ]
        }
        {
          name: 'vmauth'
          image: vmauthImage
          resources: {
            cpu: json('0.25')
            memory: '256Mi'
          }
          args: [
            '-auth.config=/etc/vmauth/config.yml'
            '-httpListenAddr=:8427'
          ]
          env: [
            {
              name: 'REMOTE_WRITE_TOKEN'
              secretRef: 'remote-write-token'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'vmauth-config'
              mountPath: '/etc/vmauth'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'vm-data'
          storageName: vmStorage.name
          storageType: 'AzureFile'
        }
        {
          name: 'vmauth-config'
          storageType: 'EmptyDir'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ── API Container App ──
resource apiContainerApp 'Microsoft.App/containerApps@2024-03-01' = if (!empty(apiImage)) {
  name: '${environmentName}-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('0.25')
            memory: '512Mi'
          }
          env: [
            {
              name: 'AzureAd__Instance'
              value: 'https://login.microsoftonline.com/'
            }
            {
              name: 'AzureAd__TenantId'
              value: entraIdTenantId
            }
            {
              name: 'AzureAd__ClientId'
              value: entraIdClientId
            }
            {
              name: 'AzureAd__Audience'
              value: 'api://${entraIdClientId}'
            }
            {
              name: 'VictoriaMetrics__Url'
              value: 'https://${vmContainerApp.properties.configuration.ingress.fqdn}'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ── Outputs ──
output vmFqdn string = vmContainerApp.properties.configuration.ingress.fqdn
output apiFqdn string = !empty(apiImage) ? apiContainerApp.properties.configuration.ingress.fqdn : ''
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
output managedIdentityClientId string = managedIdentity.properties.clientId
