#!/usr/bin/env python3
import http.client
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def json_request(request):
    body = request.get("body")
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"content-type": "application/json"}
    if request.get("token"):
        headers["authorization"] = request["token"]
    api_request = urllib.request.Request(
        request["baseUrl"] + request["route"],
        data=data,
        headers=headers,
        method=request.get("method", "POST"),
    )
    try:
        with urllib.request.urlopen(api_request, timeout=request.get("timeoutSeconds", 30)) as response:
            emit({"http": response.status, "payload": json.loads(response.read().decode("utf-8"))})
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"code": error.code, "message": "non-json response"}
        emit({"http": error.code, "payload": payload})


def stream_upload(request):
    parsed = urllib.parse.urlsplit(request["baseUrl"])
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
        raise RuntimeError("upload endpoint must use NAS loopback HTTP")
    source_path = request["sourcePath"]
    size = os.path.getsize(source_path)
    connection = http.client.HTTPConnection(
        parsed.hostname,
        parsed.port,
        timeout=request.get("timeoutSeconds", 3600),
    )
    endpoint = parsed.path.rstrip("/") + "/api/fs/put"
    connection.putrequest("PUT", endpoint)
    connection.putheader("authorization", request["token"])
    connection.putheader("File-Path", urllib.parse.quote(request["targetPath"], safe=""))
    connection.putheader("As-Task", "false")
    connection.putheader("Content-Type", "application/octet-stream")
    connection.putheader("Content-Length", str(size))
    connection.endheaders()
    with open(source_path, "rb") as source:
        while True:
            chunk = source.read(4 * 1024 * 1024)
            if not chunk:
                break
            connection.send(chunk)
    response = connection.getresponse()
    raw = response.read().decode("utf-8", errors="replace")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {"code": response.status, "message": "non-json response"}
    emit({"http": response.status, "payload": payload})
    connection.close()


def main():
    request = json.load(sys.stdin)
    action = request.get("action")
    if action == "json":
        json_request(request)
    elif action == "upload":
        stream_upload(request)
    else:
        raise RuntimeError("unsupported helper action")


if __name__ == "__main__":
    main()
