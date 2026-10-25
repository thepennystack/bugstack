output "access_team_domain" {
  description = "Team domain host for ACCESS_TEAM_DOMAIN."
  value       = var.team_domain
}

output "access_aud" {
  description = "Audience tag of the bugstack-admin application for ACCESS_AUD."
  value       = cloudflare_zero_trust_access_application.admin.aud
}

output "access_client_id" {
  description = "Client id of the bugstack-automation service token, for ADMIN_CLIENT_ID."
  value       = cloudflare_zero_trust_access_service_token.automation.client_id
}

output "access_client_secret" {
  description = "Client secret of the bugstack-automation service token."
  value       = cloudflare_zero_trust_access_service_token.automation.client_secret
  sensitive   = true
}

output "d1_database_id" {
  description = "Id of the bugstack D1 database, bound as DB in wrangler.jsonc."
  value       = cloudflare_d1_database.bugstack.uuid
}
