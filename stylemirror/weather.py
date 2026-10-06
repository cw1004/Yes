# -*- coding: utf-8 -*-
"""오늘 날씨 가져오기 — Open-Meteo (무료, API 키 불필요).

인터넷이 안 되면 계절 평균값으로 대체해서 거울이 멈추지 않게 한다.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date
from typing import Optional

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

# WMO 날씨 코드 → 한국어
WMO_KO = {
    0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림",
    45: "안개", 48: "안개",
    51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
    61: "약한 비", 63: "비", 65: "강한 비",
    66: "어는 비", 67: "어는 비",
    71: "약한 눈", 73: "눈", 75: "많은 눈", 77: "싸락눈",
    80: "소나기", 81: "소나기", 82: "강한 소나기",
    85: "눈 소나기", 86: "강한 눈 소나기",
    95: "뇌우", 96: "우박 동반 뇌우", 99: "우박 동반 뇌우",
}

# 오프라인 대체용 서울 월별 평균 기온(°C, 대략값)
MONTHLY_AVG_C = [-2, 1, 6, 13, 18, 23, 25, 26, 21, 15, 7, 0]


@dataclass
class Weather:
    city: str
    temp: float            # 현재 기온
    feels_like: float      # 체감 기온
    temp_min: float
    temp_max: float
    rain_chance: int       # 오늘 최대 강수확률(%)
    condition: str         # "맑음", "비" …
    pm10: Optional[float] = None
    pm25: Optional[float] = None
    source: str = "open-meteo"

    @property
    def is_rainy(self) -> bool:
        return self.rain_chance >= 50 or any(w in self.condition for w in ("비", "소나기", "뇌우"))

    @property
    def is_snowy(self) -> bool:
        return "눈" in self.condition

    @property
    def daily_swing(self) -> float:
        """일교차"""
        return self.temp_max - self.temp_min

    @property
    def dust_level(self) -> str:
        """미세먼지 등급(한국 환경부 PM2.5 기준)."""
        if self.pm25 is None:
            return "정보 없음"
        if self.pm25 <= 15:
            return "좋음"
        if self.pm25 <= 35:
            return "보통"
        if self.pm25 <= 75:
            return "나쁨"
        return "매우 나쁨"

    def summary(self) -> str:
        s = (f"{self.city} {self.condition}, 현재 {self.temp:.0f}°C(체감 {self.feels_like:.0f}°C), "
             f"최저 {self.temp_min:.0f}° / 최고 {self.temp_max:.0f}°, 강수확률 {self.rain_chance}%")
        if self.pm25 is not None:
            s += f", 미세먼지 {self.dust_level}"
        return s

    def to_dict(self) -> dict:
        d = asdict(self)
        d.update(summary=self.summary(), is_rainy=self.is_rainy,
                 dust_level=self.dust_level, daily_swing=round(self.daily_swing, 1))
        return d


def _get_json(url: str, params: dict, timeout: float) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(full, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_weather(lat: float, lon: float, city: str = "", timeout: float = 6.0) -> Weather:
    data = _get_json(FORECAST_URL, {
        "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 1,
        "current": "temperature_2m,apparent_temperature,weather_code",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    }, timeout)
    cur, daily = data["current"], data["daily"]
    w = Weather(
        city=city,
        temp=float(cur["temperature_2m"]),
        feels_like=float(cur["apparent_temperature"]),
        temp_min=float(daily["temperature_2m_min"][0]),
        temp_max=float(daily["temperature_2m_max"][0]),
        rain_chance=int(daily["precipitation_probability_max"][0] or 0),
        condition=WMO_KO.get(int(cur["weather_code"]), "알 수 없음"),
    )
    try:  # 미세먼지는 실패해도 무시
        air = _get_json(AIR_URL, {"latitude": lat, "longitude": lon,
                                  "current": "pm10,pm2_5"}, timeout)["current"]
        w.pm10, w.pm25 = air.get("pm10"), air.get("pm2_5")
    except Exception:
        pass
    return w


def offline_weather(city: str = "", today: Optional[date] = None) -> Weather:
    t = float(MONTHLY_AVG_C[(today or date.today()).month - 1])
    return Weather(city=city, temp=t, feels_like=t, temp_min=t - 5, temp_max=t + 5,
                   rain_chance=0, condition="정보 없음(오프라인 평균값)", source="offline")


def get_weather(lat: float, lon: float, city: str = "") -> Weather:
    try:
        return fetch_weather(lat, lon, city)
    except Exception:
        return offline_weather(city)
