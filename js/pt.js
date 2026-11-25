// PT 예약 (날짜별) + 매주 고정 요일(선택)
import { db, today, addDays, weekStart, parseISO, workoutsOf } from './store.js';

export const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
export const dowOf = (d) => DOW_KR[parseISO(d).getDay()];
const pt = () => (db.settings.pt ||= { total: null, done0: 0, days: [], time: '', bookings: [] });
export const ptDone = (d) => workoutsOf(d).some((w) => w.type === 'pt');

export function bookings() {
  const p = pt();
  p.bookings ||= [];
  return p.bookings.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
export const bookingOn = (d) => bookings().find((b) => b.date === d) || null;
export function addBooking(date, time) {
  const list = bookings();
  const ex = list.find((b) => b.date === date);
  if (ex) ex.time = time || ex.time;
  else list.push({ date, time: time || '' });
  if (time) pt().time = time; // 다음 예약 때 기본 시간
}
export function removeBooking(date) {
  const p = pt();
  p.bookings = bookings().filter((b) => b.date !== date);
}
/** 그날 PT 일정 (예약 우선, 없으면 매주 고정 요일) */
export function ptPlanOn(d) {
  const b = bookingOn(d);
  if (b) return { date: d, time: b.time, booked: true };
  if ((pt().days || []).includes(dowOf(d))) return { date: d, time: pt().time, booked: false };
  return null;
}
/** 다음 PT (오늘 포함, 아직 기록 안 한 것) */
export function nextPt() {
  for (let i = 0; i < 60; i++) {
    const d = addDays(today(), i);
    const p = ptPlanOn(d);
    if (p && !ptDone(d)) return p;
  }
  return null;
}
/** 이번 주(월~일) PT 일정 */
export function ptThisWeek() {
  const ws = weekStart(today());
  return Array.from({ length: 7 }, (_, i) => ptPlanOn(addDays(ws, i))).filter(Boolean);
}
/** 지난 예약은 정리 (30일 지난 것) */
export function pruneBookings() {
  const p = pt();
  const cut = addDays(today(), -30);
  p.bookings = bookings().filter((b) => b.date >= cut);
}
