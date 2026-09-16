# 하나의 길 — ONE WAY
# 파이썬 표준 라이브러리만으로 동작하므로 이미지가 아주 가볍습니다.
FROM python:3.12-slim

# 선택 의존성. 키가 없으면 설치해도 오프라인 엔진으로 동작합니다.
RUN pip install --no-cache-dir anthropic>=0.40.0

# 루트로 돌리지 않습니다.
RUN useradd --create-home --uid 10001 oneway
WORKDIR /app

COPY oneway/ ./oneway/
COPY README-ONEWAY.md ./

# 방문 기록·장부가 쌓이는 곳. docker-compose 에서 볼륨으로 붙입니다.
RUN mkdir -p /data && chown -R oneway:oneway /app /data
USER oneway

# 설정은 환경변수로 줍니다. config.json 을 붙이면 그것도 함께 읽습니다.
# 설정 파일이 없다고 죽지 않습니다 — 첫 실행이 파일 하나 때문에 실패하면 안 됩니다.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ONEWAY_DATA=/data \
    ONEWAY_CONFIG=/app/config/config.json \
    ONEWAY_TRUST_PROXY=1

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status==200 else 1)"

# 컨테이너 안에서는 모든 주소에서 받습니다. 바깥 노출은 nginx 가 막습니다.
CMD ["python3", "-m", "oneway", "serve", "--host", "0.0.0.0", "--port", "8000"]
