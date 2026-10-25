variable "account_id" {
  type        = string
  description = "Cloudflare account that owns the Worker, the D1 database and the Zero Trust organization."
  default     = "f496802dcadb597e5939f6449c759a43"
}

variable "app_domains" {
  type        = list(string)
  description = "Hostnames of the bugstack Worker that Access guards; the first is the primary domain."
  default     = ["bugstack.kattebak.fyi", "bugstack.matthijs-f49.workers.dev"]
}

variable "admin_email" {
  type        = string
  description = "The one email address the admin policy allows."
  default     = "matthijs@ischen.nl"
}

variable "otp_idp_id" {
  type        = string
  description = "One-time PIN identity provider, owned by stallion's state."
  default     = "5aaa1266-c206-4b87-9190-872eecff4fe4"
}

variable "team_domain" {
  type        = string
  description = "Zero Trust team domain, owned by stallion's state."
  default     = "stallion-app.cloudflareaccess.com"
}
