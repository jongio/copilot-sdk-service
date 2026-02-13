targetScope = 'resourceGroup'

@description('Name of the environment')
param environmentName string

@description('Location for all resources')
param location string = resourceGroup().location

@description('Tags for all resources')
param tags object = {}

@secure()
@description('GitHub token for Copilot SDK')
param githubToken string = ''

@description('Unique suffix for resource names')
param resourceSuffix string

@description('Short environment name for constrained resources')
param shortName string

// ===================== //
// AZD Pattern: Monitoring (Log Analytics + App Insights)
// ===================== //

module monitoring 'br/public:avm/ptn/azd/monitoring:0.2.1' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: 'law-${environmentName}-${resourceSuffix}'
    applicationInsightsName: 'ai-${environmentName}-${resourceSuffix}'
    location: location
    tags: tags
  }
}

// ===================== //
// AVM Resource: Managed Identity
// ===================== //

module managedIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.5.0' = {
  name: 'managed-identity'
  params: {
    name: 'id-${environmentName}-${resourceSuffix}'
    location: location
    tags: tags
  }
}

// ===================== //
// AVM Resource: Key Vault (stores GITHUB_TOKEN)
// ===================== //

module keyVault 'br/public:avm/res/key-vault/vault:0.13.3' = {
  name: 'key-vault'
  params: {
    name: 'kv-${shortName}-${resourceSuffix}'
    location: location
    tags: tags
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: false
    softDeleteRetentionInDays: 7
    sku: 'standard'
    secrets: [
      {
        name: 'github-token'
        value: githubToken
      }
    ]
    roleAssignments: [
      {
        principalId: managedIdentity.outputs.principalId
        roleDefinitionIdOrName: 'Key Vault Secrets User'
        principalType: 'ServicePrincipal'
      }
    ]
  }
}

// ===================== //
// AZD Pattern: Container Apps Stack (Environment + ACR)
// ===================== //

module containerAppsStack 'br/public:avm/ptn/azd/container-apps-stack:0.3.0' = {
  name: 'container-apps-stack'
  params: {
    containerAppsEnvironmentName: 'cae-${environmentName}-${resourceSuffix}'
    containerRegistryName: 'acr${shortName}${resourceSuffix}'
    logAnalyticsWorkspaceName: monitoring.outputs.logAnalyticsWorkspaceName
    appInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    location: location
    tags: tags
    acrSku: 'Basic'
    acrAdminUserEnabled: false
    zoneRedundant: false
    publicNetworkAccess: 'Enabled'
  }
}

// ===================== //
// AZD Pattern: ACR Container App - API (internal, accessed through web)
// ===================== //

module containerAppApi 'br/public:avm/ptn/azd/acr-container-app:0.4.0' = {
  name: 'container-app-api'
  params: {
    name: 'ca-api-${environmentName}-${resourceSuffix}'
    location: location
    tags: union(tags, { 'azd-service-name': 'api' })
    containerAppsEnvironmentName: containerAppsStack.outputs.environmentName
    containerRegistryName: containerAppsStack.outputs.registryName
    identityType: 'UserAssigned'
    identityName: managedIdentity.outputs.name
    userAssignedIdentityResourceId: managedIdentity.outputs.resourceId
    principalId: managedIdentity.outputs.principalId
    targetPort: 3000
    external: false
    ingressTransport: 'http'
    containerCpuCoreCount: '0.5'
    containerMemory: '1.0Gi'
    containerMinReplicas: 1
    containerMaxReplicas: 3
    env: [
      { name: 'PORT', value: '3000' }
      { name: 'ALLOWED_ORIGINS', value: 'https://ca-web-${environmentName}-${resourceSuffix}.${containerAppsStack.outputs.defaultDomain}' }
      { name: 'GITHUB_TOKEN', secretRef: 'github-token' }
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: monitoring.outputs.applicationInsightsConnectionString
      }
    ]
    secrets: [
      {
        name: 'github-token'
        keyVaultUrl: keyVault.outputs.secrets[0].uri
        identity: managedIdentity.outputs.resourceId
      }
    ]
  }
}

// ===================== //
// AZD Pattern: ACR Container App - Web
// ===================== //

module containerAppWeb 'br/public:avm/ptn/azd/acr-container-app:0.4.0' = {
  name: 'container-app-web'
  params: {
    name: 'ca-web-${environmentName}-${resourceSuffix}'
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    containerAppsEnvironmentName: containerAppsStack.outputs.environmentName
    containerRegistryName: containerAppsStack.outputs.registryName
    identityType: 'UserAssigned'
    identityName: managedIdentity.outputs.name
    userAssignedIdentityResourceId: managedIdentity.outputs.resourceId
    principalId: managedIdentity.outputs.principalId
    targetPort: 80
    external: true
    ingressTransport: 'auto'
    containerCpuCoreCount: '0.25'
    containerMemory: '0.5Gi'
    containerMinReplicas: 1
    containerMaxReplicas: 3
    env: [
      { name: 'API_URL', value: 'http://${containerAppApi.outputs.name}.internal.${containerAppsStack.outputs.defaultDomain}' }
    ]
  }
}

// ===================== //
// Outputs
// ===================== //

output apiContainerAppUrl string = containerAppApi.outputs.uri
output webContainerAppUrl string = containerAppWeb.outputs.uri
output registryLoginServer string = containerAppsStack.outputs.registryLoginServer
output registryName string = containerAppsStack.outputs.registryName
