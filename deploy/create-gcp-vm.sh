#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"
readonly REGION="asia-northeast3"
readonly ZONE="asia-northeast3-a"
readonly VM_NAME="lecturai-web"
readonly ADDRESS_NAME="lecturai-web-ip"
readonly FIREWALL_NAME="lecturai-allow-web"
readonly NETWORK_NAME="default"

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Usage: bash deploy/create-gcp-vm.sh GOOGLE_CLOUD_PROJECT_ID"
  exit 1
fi

gcloud config set project "${PROJECT_ID}"
gcloud services enable compute.googleapis.com --project "${PROJECT_ID}"

if ! gcloud compute networks describe "${NETWORK_NAME}" \
  --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "The default VPC network is missing. Create or select a VPC before continuing."
  exit 1
fi

if ! gcloud compute addresses describe "${ADDRESS_NAME}" \
  --project "${PROJECT_ID}" --region "${REGION}" >/dev/null 2>&1; then
  gcloud compute addresses create "${ADDRESS_NAME}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --network-tier PREMIUM
fi

external_ip="$(gcloud compute addresses describe "${ADDRESS_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(address)')"

if ! gcloud compute firewall-rules describe "${FIREWALL_NAME}" \
  --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "${FIREWALL_NAME}" \
    --project "${PROJECT_ID}" \
    --network "${NETWORK_NAME}" \
    --direction INGRESS \
    --action ALLOW \
    --rules tcp:80,tcp:443,udp:443 \
    --source-ranges 0.0.0.0/0 \
    --target-tags lecturai-web
fi

if ! gcloud compute instances describe "${VM_NAME}" \
  --project "${PROJECT_ID}" --zone "${ZONE}" >/dev/null 2>&1; then
  gcloud compute instances create "${VM_NAME}" \
    --project "${PROJECT_ID}" \
    --zone "${ZONE}" \
    --machine-type e2-medium \
    --network "${NETWORK_NAME}" \
    --address "${external_ip}" \
    --network-tier PREMIUM \
    --tags lecturai-web \
    --image-family ubuntu-2404-lts-amd64 \
    --image-project ubuntu-os-cloud \
    --boot-disk-type pd-balanced \
    --boot-disk-size 30GB \
    --maintenance-policy MIGRATE \
    --provisioning-model STANDARD
fi

echo "VM: ${VM_NAME}"
echo "Zone: ${ZONE}"
echo "Static IP: ${external_ip}"
echo "Temporary HTTPS hostname: lecturai.${external_ip//./-}.sslip.io"
echo
echo "Next: open Compute Engine > VM instances > ${VM_NAME} > SSH."
echo "Then run the deployment commands from the project README."
