#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_DIR="/opt/lecturai"
readonly APP_BRANCH="agent/gcp-vm-deployment"
readonly APP_REPOSITORY="https://github.com/yuupmu/LecturAI.git"
readonly METADATA_URL="http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as the normal SSH user, not root."
  exit 1
fi

read -r -p "OpenAI API key: " -s OPENAI_API_KEY_INPUT
echo
if [[ -z "${OPENAI_API_KEY_INPUT}" ]]; then
  echo "OPENAI_API_KEY is required."
  exit 1
fi

read -r -p "HTTPS certificate email: " ACME_EMAIL_INPUT
if [[ -z "${ACME_EMAIL_INPUT}" ]]; then
  echo "An email address is required for certificate notices."
  exit 1
fi

read -r -p "Site login username [lecturai]: " SITE_USERNAME_INPUT
SITE_USERNAME_INPUT="${SITE_USERNAME_INPUT:-lecturai}"
if [[ ! "${SITE_USERNAME_INPUT}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "The site username may contain only letters, numbers, dots, underscores, and hyphens."
  exit 1
fi

read -r -p "Site login password (at least 12 characters): " -s SITE_PASSWORD_INPUT
echo
if (( ${#SITE_PASSWORD_INPUT} < 12 )); then
  echo "The site password must contain at least 12 characters."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

ubuntu_codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
architecture="$(dpkg --print-architecture)"
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${ubuntu_codename}
Components: stable
Architectures: ${architecture}
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

if [[ -d "${APP_DIR}/.git" ]]; then
  if [[ -n "$(sudo git -C "${APP_DIR}" status --porcelain)" ]]; then
    echo "${APP_DIR} has local changes. Resolve them before redeploying."
    exit 1
  fi
  sudo git -C "${APP_DIR}" fetch origin "${APP_BRANCH}"
  sudo git -C "${APP_DIR}" checkout "${APP_BRANCH}"
  sudo git -C "${APP_DIR}" merge --ff-only FETCH_HEAD
else
  sudo git clone --branch "${APP_BRANCH}" --single-branch \
    "${APP_REPOSITORY}" "${APP_DIR}"
fi

external_ip="$(curl -fsS -H 'Metadata-Flavor: Google' "${METADATA_URL}")"
site_address="lecturai.${external_ip//./-}.sslip.io"
password_hash="$(sudo docker run --rm caddy:2.10-alpine \
  caddy hash-password --plaintext "${SITE_PASSWORD_INPUT}")"

sudo install -d -m 0700 /etc/lecturai
sudo tee /etc/lecturai/app.env >/dev/null <<EOF
OPENAI_API_KEY=${OPENAI_API_KEY_INPUT}
OPENAI_FAST_MODEL=gpt-4.1-nano
OPENAI_SMART_MODEL=gpt-4.1-nano
OPENAI_FINAL_NOTE_MODEL=gpt-4.1-nano
OPENAI_MATERIAL_MODEL=gpt-4.1-nano
OPENAI_SEARCH_MODEL=
OPENAI_TRANSLATION_MODEL=gpt-4.1-nano
LECTURE_NOTE_INTERVAL_SECONDS=120
LECTURE_ENDING_GRACE_SECONDS=10
LECTURE_INACTIVITY_SECONDS=600
LECTURE_INACTIVITY_GRACE_SECONDS=30
NEXT_PUBLIC_ENABLE_DEMO_CONTROLS=false
EOF

sudo tee /etc/lecturai/caddy.env >/dev/null <<EOF
SITE_ADDRESS=${site_address}
ACME_EMAIL=${ACME_EMAIL_INPUT}
SITE_USERNAME=${SITE_USERNAME_INPUT}
SITE_PASSWORD_HASH=${password_hash}
EOF

sudo chmod 0600 /etc/lecturai/app.env /etc/lecturai/caddy.env
sudo docker compose -f "${APP_DIR}/compose.yaml" up -d --build

echo "Waiting for HTTPS certificate and application health..."
for attempt in {1..24}; do
  if curl -fsS -u "${SITE_USERNAME_INPUT}:${SITE_PASSWORD_INPUT}" \
    "https://${site_address}/api/health"; then
    echo
    echo "LecturAI is ready: https://${site_address}"
    echo "Login username: ${SITE_USERNAME_INPUT}"
    exit 0
  fi
  sleep 5
done

echo "The containers started, but HTTPS did not become ready in time."
echo "Check: sudo docker compose -f ${APP_DIR}/compose.yaml logs --tail=200"
exit 1
