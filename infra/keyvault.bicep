// Key Vault module for EP Cube Graph
// Stores the remote-write bearer token secret with managed identity access

@description('Name of the Key Vault')
param keyVaultName string

@description('Azure region for the Key Vault')
param location string = resourceGroup().location

@description('Principal ID of the managed identity that needs Key Vault access')
param managedIdentityPrincipalId string

@description('The remote-write bearer token value')
@secure()
param remoteWriteToken string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// Key Vault Secrets User role assignment for the managed identity
resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentityPrincipalId, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource remoteWriteTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'remote-write-token'
  properties: {
    value: remoteWriteToken
  }
}

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
