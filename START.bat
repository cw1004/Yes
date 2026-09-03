@echo off
chcp 65001 >nul
title INDIA 2030 스튜디오
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo 파이썬이 설치되어 있지 않습니다.
  echo https://www.python.org/downloads/ 에서 설치할 때
  echo "Add Python to PATH" 를 반드시 체크하세요.
  pause & exit /b 1
)

echo [1/3] 필요한 패키지를 확인합니다...
python -c "import PIL" 2>nul || python -m pip install -q -r requirements.txt

echo [2/3] 실행 환경을 점검합니다...
python -m india2030 check

echo [3/3] 스튜디오를 엽니다. 브라우저가 자동으로 열립니다.
echo       창을 닫으려면 이 검은 창에서 Ctrl+C 를 누르세요.
python -m india2030 studio --port 8500
pause
