/*
 * 테마·글자 크기를 첫 페인트 전에 적용합니다.
 *
 * React 안에서 적용하면 기본값(다크)으로 한 번 그려진 뒤 바뀌어서
 * 화면이 번쩍입니다. 그래서 <head> 에서 동기적으로 실행합니다.
 *
 * CSP 가 script-src 'self' 라 인라인 스크립트는 차단됩니다.
 * 인라인 해시를 CSP 에 넣으면 스크립트를 고칠 때마다 해시를 같이 고쳐야 하므로,
 * 같은 오리진의 별도 파일로 둡니다.
 */
;(function () {
  try {
    var theme = localStorage.getItem('roomcraft-theme')
    // 저장된 선택이 없으면 밝은 테마로 시작합니다.
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light')
  }
  try {
    var size = { normal: 16, large: 18, xlarge: 20 }[localStorage.getItem('roomcraft-text-size')]
    if (size) document.documentElement.style.setProperty('--rc-root-size', size + 'px')
  } catch (e) {
    /* 저장소가 막혀 있어도 기본값으로 동작합니다. */
  }
})()
