# 수동 입력 (CSV)

공개 상품 API 가 없는 판매처를 위한 통로입니다. **올리브영이 대표적인 경우**로,
제휴 네트워크(링크프라이스 등)를 통해 링크만 받고 가격·재고는 직접 넣어야 합니다.

- 파일 이름이 곧 판매처 코드입니다: `oliveyoung.csv` → merchant `oliveyoung`
  (`data/products.json` 의 `merchants` 에 있는 코드와 같아야 합니다)
- 엑셀/구글시트에서 편집한 뒤 CSV 로 내보내면 됩니다. 개발 지식이 필요 없습니다.
- `npm run sync:catalog` 을 돌리면 API 데이터와 함께 합쳐집니다.

| 열 | 필수 | 설명 |
|---|---|---|
| brand | ✓ | 브랜드명 |
| name | ✓ | 상품명 (브랜드 빼고) |
| category | | serum / toner / cream / suncare / cushion / foundation / cleanser / exfoliant / eyecare / mask / lip |
| price | ✓ | 판매가 (숫자만) |
| coupon | | 즉시 할인 금액 |
| shippingDays | | 배송 소요일 (기본 2) |
| stock | | false / 품절 이면 품절 처리 |
| url | | **상품 페이지 주소**. 넣으면 구매 버튼이 그 페이지로 직접 갑니다(추적 파라미터 자동 부착). 비우면 검색 딥링크 |
| rating, reviews | | 있으면 랭킹의 전환 기대치에 반영됩니다 |

가격이 자주 바뀌므로 **주 1회 이상 갱신**하는 걸 권합니다. 오래된 가격은 환불 사유가 됩니다.
