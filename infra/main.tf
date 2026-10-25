terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.26"
    }
  }

  backend "local" {}
}

provider "cloudflare" {}

resource "cloudflare_d1_database" "bugstack" {
  account_id = var.account_id
  name       = "bugstack"

  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_zero_trust_access_service_token" "automation" {
  account_id = var.account_id
  name       = "bugstack-automation"
  duration   = "8760h"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "admin" {
  account_id = var.account_id
  name       = "bugstack-admin"
  decision   = "allow"
  include = [{
    email = {
      email = var.admin_email
    }
  }]
}

resource "cloudflare_zero_trust_access_policy" "automation" {
  account_id = var.account_id
  name       = "bugstack-automation"
  decision   = "non_identity"
  include = [{
    service_token = {
      token_id = cloudflare_zero_trust_access_service_token.automation.id
    }
  }]
}

resource "cloudflare_zero_trust_access_policy" "public" {
  account_id = var.account_id
  name       = "bugstack-public"
  decision   = "bypass"
  include = [{
    everyone = {}
  }]
}

resource "cloudflare_zero_trust_access_application" "admin" {
  account_id = var.account_id
  name       = "bugstack-admin"
  type       = "self_hosted"
  domain     = var.app_domains[0]
  destinations = [for host in var.app_domains : {
    type = "public"
    uri  = host
  }]
  session_duration          = "720h"
  auto_redirect_to_identity = true
  enable_binding_cookie     = false
  options_preflight_bypass  = false
  allowed_idps              = [var.otp_idp_id]
  policies = [{
    id         = cloudflare_zero_trust_access_policy.admin.id
    precedence = 1
    }, {
    id         = cloudflare_zero_trust_access_policy.automation.id
    precedence = 2
  }]
}

resource "cloudflare_zero_trust_access_application" "reports" {
  account_id = var.account_id
  name       = "bugstack-reports"
  type       = "self_hosted"
  domain     = "${var.app_domains[0]}/v1"
  destinations = [for host in var.app_domains : {
    type = "public"
    uri  = "${host}/v1"
  }]
  session_duration         = "24h"
  enable_binding_cookie    = false
  options_preflight_bypass = false
  allowed_idps             = [var.otp_idp_id]
  policies = [{
    id         = cloudflare_zero_trust_access_policy.public.id
    precedence = 1
  }]
}
