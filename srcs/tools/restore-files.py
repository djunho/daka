import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile


BACKUP = Path("/restore")
UPLOADS = {
    "media.tar.gz": Path("/data/media"),
    "documents.tar.gz": Path("/data/documents"),
}
USE = re.compile(rb"^\s*USE\s+(`(?:[^`]|\x60\x60)+`|[\w$]+)\s*;\s*(?:--.*)?$", re.IGNORECASE)


def validate_database():
    database = os.environ["MYSQL_DATABASE"].encode()
    dump = BACKUP / "database.sql"
    if not dump.is_file() or dump.stat().st_size == 0:
        raise ValueError("Missing or empty database.sql")
    with dump.open("rb") as sql:
        for line in sql:
            match = USE.match(line)
            if match:
                name = match[1]
                if name.startswith(b"`"):
                    name = name[1:-1].replace(b"``", b"`")
                if name != database:
                    raise ValueError("SQL dump selects a database other than MYSQL_DATABASE")


def safe_member(member, destination):
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
        raise ValueError(f"Unsafe archive member: {member.name!r}")
    return tarfile.data_filter(member, destination)


def restore_uploads(mode):
    for filename, destination in UPLOADS.items():
        if any(destination.iterdir()):
            raise ValueError(f"Volume {destination} must be empty")
        archive = BACKUP / filename
        if filename == "documents.tar.gz" and not archive.exists():
            if mode not in {"check", "0"}:
                raise ValueError("documents.tar.gz is missing but the restored database contains documents")
            continue
        with tarfile.open(archive, "r:gz") as contents:
            for member in contents:
                safe_member(member, destination)

    if mode == "check":
        return
    for filename, destination in UPLOADS.items():
        archive = BACKUP / filename
        if archive.exists():
            with tarfile.open(archive, "r:gz") as contents:
                contents.extractall(destination, filter=safe_member)
        else:
            print("No documents archive in this legacy backup. The database has no document records.")


try:
    mode = sys.argv[1]
    if mode == "check":
        validate_database()
    restore_uploads(mode)
except (OSError, ValueError, tarfile.TarError) as error:
    sys.exit(f"restore: {error}")
