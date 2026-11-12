# memyma 🏊🏋️

수영(강습 / 자유수영)과 헬스(PT 수업 / 개인운동) 기록용 웹앱입니다.
애플워치 운동 기록(아이폰 **피트니스** 앱의 운동 상세 화면)을 캡처해서 넣으면 Claude가 수치를 읽고 분석해 줍니다.

## 할 수 있는 것

- **새 기록**: 운동 종류 고르기 → 캡처 추가(최대 6장) → `캡처 읽고 분석하기`
  - 운동 시간, 활동/총 칼로리, 평균·최대·최저 심박, 심박수 영역(1~5), 수영 거리·랩·페이스를 자동으로 채움
  - 읽은 값은 저장 전에 직접 고칠 수 있음
  - AI 분석: 요약, 강도, 눈에 띄는 점, **최근 같은 종류 운동과 비교**, 다음 운동 제안
  - 캡처 없이 수치만 입력해도 분석 가능
- **헬스 종목·세트 기록** (PT / 개인운동): 종목 이름(자동완성), 세트별 무게·횟수, 직전 세트 복사,
  "지난번 종목 불러오기", 종목마다 지난번 기록 표시, 총 볼륨 계산. AI 분석도 무게·볼륨 변화를 보고 다음 목표를 제안
- **요약**: 이번 달 횟수·시간·칼로리·수영 거리, 주별 운동 시간(종류별 누적 막대), 운동별 평균/최대 심박 추이, **종목별 성장**(회차별 최고 무게 그래프)
- **기록**: 월별 목록, 수영/헬스 필터, 상세 화면(지난번 대비 변화, 심박 영역 막대)
- **설정**: JSON 백업 내보내기/불러오기, 앱 암호

> 기록은 브라우저(localStorage)에 저장됩니다. 캡처 이미지는 분석에만 쓰고 저장하지 않아요.
> 기기를 바꾸거나 브라우저 데이터를 지우기 전에 **설정 → 내보내기**로 백업하세요.

## 실행

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY 입력
npm run dev                  # http://localhost:3000
```

## Vercel 배포

1. **Claude API 키 만들기** – https://console.anthropic.com → 결제 정보(크레딧) 등록 → API Keys → Create Key (`sk-ant-...` 복사)
2. **코드를 main 브랜치에 합치기** – Vercel은 기본적으로 `main` 브랜치를 배포해요.
   GitHub에서 이 브랜치로 Pull Request를 만들어 merge 하세요.
3. **Vercel 프로젝트 만들기** – https://vercel.com 에 GitHub 계정으로 로그인 → **Add New… → Project** →
   `memyma` 저장소 **Import** (목록에 없으면 *Adjust GitHub App Permissions*에서 저장소 접근 허용)
4. **환경변수 넣기** – Import 화면의 *Environment Variables*에 추가
   - `ANTHROPIC_API_KEY` = 1번에서 만든 키
   - `APP_PASSCODE` = 아무 암호 (남이 내 키로 분석하지 못하게)
5. **Deploy** 클릭 → 1~2분 뒤 `https://memyma-xxxx.vercel.app` 주소가 나와요.
6. 아이폰 Safari로 접속 → **설정 → 앱 암호**에 `APP_PASSCODE`와 같은 값 저장 → 공유 버튼 → **홈 화면에 추가**

이후에는 main에 새 코드가 합쳐질 때마다 자동으로 다시 배포돼요.
환경변수를 나중에 바꿨다면 Vercel의 *Deployments → 최신 배포 → Redeploy*를 눌러야 반영돼요.

## 구조

| 경로 | 내용 |
|---|---|
| `app/api/analyze/route.ts` | 캡처 → Claude 비전(구조화 출력)으로 수치 추출 + 분석 |
| `app/page.tsx` | 탭 화면 (요약 / 기록 / 새 기록 / 설정) |
| `components/` | 대시보드, 차트, 입력·상세 화면 |
| `lib/types.ts` | 운동 기록 데이터 모델 |
| `lib/storage.ts` | localStorage 저장 |
| `lib/image.ts` | 업로드 전 캡처 리사이즈 (긴 변 1568px JPEG) |
