targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment')
param environmentName string

@description('Location for all resources')
param location string

@secure()
@description('GitHub token for Copilot SDK')
param githubToken string = ''

var tags = { 'azd-env-name': environmentName }
var resourceSuffix = take(uniqueString(subscription().id, environmentName), 6)
var shortName = take(replace(environmentName, '-', ''), 10)

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources './resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    githubToken: githubToken
    resourceSuffix: resourceSuffix
    shortName: shortName
  }
}

output AZURE_CONTAINER_APP_API_URL string = resources.outputs.apiContainerAppUrl
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = resources.outputs.registryName
