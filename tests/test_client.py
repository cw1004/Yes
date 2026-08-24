from __future__ import annotations

import json

import pytest
import responses

from kis.client import KisClient
from kis.errors import ApiError, HttpError
from kis.ratelimit import RateLimiter


@pytest.fixture
def client(settings):
    # 테스트에서는 유량 제한 때문에 느려지지 않도록 넉넉히 준다.
    return KisClient(settings, limiter=RateLimiter(1000))


def test_tr_id_switches_to_paper(client):
    assert client.tr("TTTC0802U") == "VTTC0802U"
    assert client.tr("TTTC8434R", "VTTC8434R") == "VTTC8434R"


def test_tr_id_untouched_in_real(real_settings):
    assert KisClient(real_settings, limiter=RateLimiter(1000)).tr("TTTC0802U") == "TTTC0802U"


@responses.activate
def test_get_sends_auth_headers(client, settings, token_response):
    token_response(responses)
    responses.add(
        responses.GET,
        f"{settings.rest_base}/uapi/test",
        json={"rt_cd": "0", "msg1": "정상", "output": {"a": "1"}},
        status=200,
    )
    res = client.get("/uapi/test", tr_id="FHKST01010100", params={"X": "1"})
    assert res.is_ok and res.output == {"a": "1"}

    sent = responses.calls[-1].request
    assert sent.headers["authorization"] == "Bearer TEST-TOKEN"
    assert sent.headers["appkey"] == settings.app_key
    assert sent.headers["tr_id"] == "FHKST01010100"
    assert sent.headers["custtype"] == "P"


@responses.activate
def test_business_error_raises_api_error(client, settings, token_response):
    token_response(responses)
    responses.add(
        responses.GET,
        f"{settings.rest_base}/uapi/test",
        json={"rt_cd": "1", "msg_cd": "40580000", "msg1": "모의투자 미지원 API 입니다"},
        status=200,
    )
    with pytest.raises(ApiError) as excinfo:
        client.get("/uapi/test", tr_id="TTTC8434R")
    assert excinfo.value.msg_cd == "40580000"
    assert "모의투자" in str(excinfo.value)


@responses.activate
def test_business_error_can_be_returned(client, settings, token_response):
    token_response(responses)
    responses.add(
        responses.GET, f"{settings.rest_base}/uapi/test",
        json={"rt_cd": "1", "msg_cd": "X", "msg1": "실패"}, status=200,
    )
    res = client.get("/uapi/test", tr_id="T", raise_on_error=False)
    assert not res.is_ok and res.msg1 == "실패"


@responses.activate
def test_retries_server_error_then_succeeds(client, settings, token_response, monkeypatch):
    monkeypatch.setattr("kis.client.time.sleep", lambda _s: None)
    token_response(responses)
    url = f"{settings.rest_base}/uapi/test"
    responses.add(responses.GET, url, json={"error": "boom"}, status=502)
    responses.add(responses.GET, url, json={"rt_cd": "0", "output": {"ok": "1"}}, status=200)

    res = client.get("/uapi/test", tr_id="T")
    assert res.is_ok


@responses.activate
def test_gives_up_after_max_retries(client, settings, token_response, monkeypatch):
    monkeypatch.setattr("kis.client.time.sleep", lambda _s: None)
    token_response(responses)
    responses.add(responses.GET, f"{settings.rest_base}/uapi/test", json={}, status=500)
    with pytest.raises(HttpError):
        client.get("/uapi/test", tr_id="T")


@responses.activate
def test_401_triggers_token_reissue(client, settings, token_response, monkeypatch):
    monkeypatch.setattr("kis.client.time.sleep", lambda _s: None)
    token_response(responses)
    responses.add(
        responses.POST, f"{settings.rest_base}/oauth2/tokenP",
        json={"access_token": "SECOND-TOKEN", "expires_in": 86400}, status=200,
    )
    url = f"{settings.rest_base}/uapi/test"
    responses.add(responses.GET, url, json={}, status=401)
    responses.add(responses.GET, url, json={"rt_cd": "0", "output": {}}, status=200)

    assert client.get("/uapi/test", tr_id="T").is_ok
    assert responses.calls[-1].request.headers["authorization"] == "Bearer SECOND-TOKEN"


@responses.activate
def test_post_body_is_sent_verbatim_with_hashkey(client, settings, token_response):
    token_response(responses)
    responses.add(responses.POST, f"{settings.rest_base}/uapi/hashkey", json={"HASH": "HASHVALUE"}, status=200)
    responses.add(
        responses.POST, f"{settings.rest_base}/uapi/order",
        json={"rt_cd": "0", "msg1": "주문 전송 완료", "output": {"ODNO": "0000117057"}}, status=200,
    )
    body = {"PDNO": "005930", "ORD_QTY": "1"}
    res = client.post("/uapi/order", tr_id="VTTC0802U", body=body, use_hashkey=True)

    assert res.body["output"]["ODNO"] == "0000117057"
    order_call = responses.calls[-1].request
    assert order_call.headers["hashkey"] == "HASHVALUE"
    assert json.loads(order_call.body.decode()) == body


@responses.activate
def test_paginate_follows_tr_cont(client, settings, token_response):
    token_response(responses)
    url = f"{settings.rest_base}/uapi/list"
    responses.add(
        responses.GET, url,
        json={"rt_cd": "0", "output1": [{"n": "1"}], "ctx_area_fk100": "FK", "ctx_area_nk100": "NK"},
        status=200, headers={"tr_cont": "F"},
    )
    responses.add(responses.GET, url, json={"rt_cd": "0", "output1": [{"n": "2"}]}, status=200,
                  headers={"tr_cont": "D"})

    pages = list(client.paginate("/uapi/list", tr_id="T", params={}))
    assert len(pages) == 2
    assert responses.calls[-1].request.headers["tr_cont"] == "N"
    assert "CTX_AREA_NK100=NK" in responses.calls[-1].request.url
