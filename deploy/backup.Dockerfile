# restic plus rclone, so backups can go to Google Drive (or anything else rclone supports).
FROM restic/restic:0.17.3
RUN apk add --no-cache rclone curl
