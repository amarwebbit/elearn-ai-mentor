import requests

login_data = {"identifier": "Amar", "password": "Amar"}
r = requests.post("http://127.0.0.1:8000/login", data=login_data)
print("login response:", r.status_code, r.text)
token = r.json().get("access_token")
if not token:
    raise SystemExit("No token returned")

headers = {"Authorization": f"Bearer {token}"}
print("Calling /me ...")
r = requests.get("http://127.0.0.1:8000/me", headers=headers)
print("/me:", r.status_code, r.text)

print("Enrolling in course 1 ...")
r = requests.post("http://127.0.0.1:8000/enroll/1", headers=headers)
print("/enroll:", r.status_code, r.text)
