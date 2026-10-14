#!/usr/bin/env python3
"""Generate independent US secrets on the US host; never print their values."""
import os
from pathlib import Path
import secrets

if __name__ == '__main__':
    assert os.geteuid() == 0, 'Run on the approved US host as root'
    root = Path('/opt/saydian-us')
    if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('US_BOOTSTRAP_CI_ROOT','').startswith('/tmp/saydian-us-ci-'):
        root = Path(os.environ['US_BOOTSTRAP_CI_ROOT'])
    directory = root/'private'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    file = directory/'runtime.env'
    keys = ['US_OWNER_PASSWORD', 'US_DATABASE_PASSWORD', 'US_REDIS_PASSWORD', 'US_ACCESS_TOKEN_SECRET',
            'US_REFRESH_TOKEN_PEPPER', 'US_FIELD_ENCRYPTION_KEY', 'US_INTEGRATION_MASTER_KEY',
            'US_MINIO_ROOT_PASSWORD', 'US_BUCKET_SECRET_KEY', 'US_BOOTSTRAP_ADMIN_PASSWORD']
    values = {key:secrets.token_hex(32) for key in keys}
    values.update(US_MINIO_ROOT_USER='us-storage-'+secrets.token_hex(6),
                  US_BUCKET_ACCESS_KEY='us-app-'+secrets.token_hex(6),
                  US_BOOTSTRAP_ADMIN_USERNAME='saydian-us-admin',
                  US_MAINTENANCE_READ_ONLY='true', US_BUSINESS_WRITES_PAUSED='true',
                  US_UNVERIFIED_REGISTRATION_ENABLED='true', US_WORKER_OUTBOUND_PAUSED='true')
    with file.open('x') as output:
        os.chmod(file, 0o600)
        output.write(''.join(key+'='+value+'\n' for key,value in values.items()))
        output.flush()
        os.fsync(output.fileno())
    for child in ['downloads','releases','acme']:
        (root/child).mkdir(mode=0o700 if child == 'releases' else 0o755,exist_ok=True)
    print('Independent US environment created; values hidden')
