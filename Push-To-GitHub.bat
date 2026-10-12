@echo off
title Push Nagomi Koi to GitHub
echo ========================================================
echo Dang push len https://github.com/limpbzkt5-cloud/wallpaper-koi-interactive
echo ========================================================
echo.
git push -u origin main --force
echo.
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Da push thanh cong len GitHub!
) else (
    echo [ERROR] Push gap loi. Vui long kiem tra lai quyen truy cap.
)
echo.
pause
