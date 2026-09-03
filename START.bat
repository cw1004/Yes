@echo off
chcp 65001 >nul
title INDIA 2030 스튜디오
cd /d "%~dp0"
echo.
echo   ===========================================
echo     INDIA 2030 스튜디오를 시작합니다
echo   ===========================================
echo.

rem --- 파이썬 찾기 : py 런처를 먼저 쓴다 -------------------------------
rem  ('python' 만 쓰면 Microsoft Store 안내창이 뜨는 PC 가 있어서)
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY (
  python --version >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo   [!] 파이썬이 설치되어 있지 않습니다.
  echo.
  echo       1. https://www.python.org/downloads/  에 접속
  echo       2. 노란 [Download Python] 버튼 클릭
  echo       3. 설치 첫 화면에서 맨 아래
  echo          [Add python.exe to PATH] 를 반드시 체크
  echo       4. 설치가 끝나면 이 파일을 다시 실행
  echo.
  pause & exit /b 1
)
for /f "delims=" %%v in ('%PY% --version 2^>^&1') do echo   파이썬 확인 : %%v

rem --- 필요한 패키지 ---------------------------------------------------
echo.
echo   [1/3] 필요한 프로그램을 준비합니다 (처음 한 번만 몇 분 걸립니다)...
%PY% -c "import PIL" >nul 2>nul
if errorlevel 1 (
  %PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
  if errorlevel 1 (
    echo   [!] 설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행해 주세요.
    pause & exit /b 1
  )
)

rem --- 환경 점검 -------------------------------------------------------
echo   [2/3] 실행 환경을 점검합니다...
echo.
%PY% -m india2030 check
if errorlevel 1 (
  echo   [!] 점검에 실패했습니다. 위 메시지를 그대로 복사해 문의해 주세요.
  pause & exit /b 1
)

rem --- 실행 -------------------------------------------------------------
echo.
echo   [3/3] 브라우저가 자동으로 열립니다.
echo         열리지 않으면 주소창에 직접 입력하세요 :  http://127.0.0.1:8500
echo.
echo         ※ 끝낼 때는 이 검은 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo.
%PY% -m india2030 studio --port 8500

echo.
echo   스튜디오가 종료되었습니다.
pause
