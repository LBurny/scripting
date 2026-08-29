import { Script, Navigation, NavigationStack, List, Section, VStack, HStack, Text, Image, Button, TextField, Spacer, useState, useEffect, fetch } from 'scripting'

const KEY = "qweather_api_key"
const HOST = "qweather_api_host"
function load(): string { return Storage.get<string>(KEY) || "" }
function loadHost(): string { return (Storage.get<string>(HOST) || "").trim() }
function normHost(h: string): string {
  return h.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
}

const DAY_G = { colors: ["rgba(26,115,232,1)", "rgba(79,195,247,1)"], startPoint: "top", endPoint: "bottom" } as any
const NIGHT_G = { colors: ["rgba(12,20,69,1)", "rgba(26,26,46,1)"], startPoint: "top", endPoint: "bottom" } as any

function icon(c: string, n: boolean): string {
  const v = parseInt(c)
  if (v === 100) return n ? "moon.stars.fill" : "sun.max.fill"
  if (v >= 101 && v <= 103) return n ? "cloud.moon.fill" : "cloud.sun.fill"
  if (v >= 200 && v <= 399) return "cloud.drizzle.fill"
  if (v >= 400 && v <= 499) return "wind"
  if (v >= 500 && v <= 599) return "cloud.fog.fill"
  if (v >= 700 && v <= 799) return "cloud.rain.fill"
  if (v >= 800 && v <= 899) return "cloud.snow.fill"
  return "cloud.sun.fill"
}

function aqic(v: string): any {
  const n = parseInt(v)
  if (isNaN(n)) return "rgba(248,197,10,1)"
  if (n <= 50) return "rgba(0,228,0,1)"
  if (n <= 100) return "rgba(255,255,0,1)"
  if (n <= 150) return "rgba(255,126,0,1)"
  if (n <= 200) return "rgba(255,0,0,1)"
  if (n <= 300) return "rgba(153,0,76,1)"
  return "rgba(126,0,35,1)"
}

interface WD { temp: string; feelsLike: string; icon: string; text: string; windDir: string; windScale: string; humidity: string; precip: string; vis: string; tempMax: string; tempMin: string }
interface AD { aqi: string; category: string; color: string | null }
interface HH { fxTime: string; temp: string; icon: string }
interface DD { fxDate: string; tempMax: string; tempMin: string; iconDay: string }

interface FetchResult { data: { now: WD; aqi: AD | null; hourly: HH[]; daily: DD[]; city: string } | null; error: string }

async function jq(r: any, tag: string): Promise<any> {
  let d: any = null
  let raw = ""
  try { d = await r.json() } catch { try { raw = ((await r.text()) || "").slice(0, 120) } catch {} }
  if (d && d.error) throw new Error(`${tag} 接口错误 ${d.error.status}: ${d.error.title || d.error.detail || "请求失败"}`)
  if (!r.ok) throw new Error(`${tag} HTTP ${r.status}${raw ? "：" + raw : ""}`)
  return d
}

async function fetchAqi(host: string, lat: number, lon: number, key: string): Promise<AD | null> {
  try {
    const r = await fetch(`https://${host}/airquality/v1/current/${lat.toFixed(2)}/${lon.toFixed(2)}`, { headers: { "X-QW-Api-Key": key } })
    const d = await r.json()
    const idx = (d?.indexes || []).find((x: any) => x.code === "cn-mee") || d?.indexes?.[0]
    if (!idx) return null
    const c = idx.color
    return { aqi: String(idx.aqiDisplay ?? idx.aqi ?? ""), category: idx.category || "", color: c ? `rgba(${c.red},${c.green},${c.blue},1)` : null }
  } catch { return null }
}

async function fetchAll(key: string, host: string): Promise<FetchResult> {
  const base = `https://${host}`
  try {
    await Location.setAccuracy("best")
    const loc = await Location.requestCurrent({ forceRequest: false })
    if (!loc) return { data: null, error: "无法获取定位，请检查定位权限" }
    const pos = `${loc.longitude.toFixed(4)},${loc.latitude.toFixed(4)}`
    const oh = { headers: { "X-QW-Api-Key": key } }
    const [nr, aq, hr, dr, gr] = await Promise.all([
      fetch(`${base}/v7/weather/now?location=${pos}`, oh),
      fetchAqi(host, loc.latitude, loc.longitude, key),
      fetch(`${base}/v7/weather/24h?location=${pos}`, oh),
      fetch(`${base}/v7/weather/7d?location=${pos}`, oh),
      fetch(`${base}/geo/v2/city/lookup?location=${pos}`, oh),
    ])
    const nd = await jq(nr, "weather/now")
    if (nd.code !== "200") return { data: null, error: `天气接口返回错误码 ${nd.code}` }
    const hd = await jq(hr, "weather/24h")
    const dd = await jq(dr, "weather/7d")
    const gd = await jq(gr, "city/lookup")
    const city = (gd.code === "200" && gd.location?.length) ? gd.location[0].name : "当前位置"
    const aqi = aq
    return { data: { now: nd.now, aqi, hourly: hd.hourly || [], daily: dd.daily || [], city }, error: "" }
  } catch (e: any) {
    return { data: null, error: String(e?.message || e || "网络请求失败") }
  }
}

const D = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
const D2 = ["明天", "后天", "大后天"]

function DetailItem({ val, label }: { val: string; label: string }) {
  return (
    <VStack spacing={1} alignment="center" frame={{ maxWidth: "infinity" }}>
      <Text font="caption2" foregroundStyle="label" fontWeight="medium">{val}</Text>
      <Text font="caption2" foregroundStyle="label" opacity={0.4}>{label}</Text>
    </VStack>
  )
}

function Page() {
  const [k, setK] = useState(load())
  const [host, setHost] = useState(() => loadHost())
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState("")
  const [apiErr, setApiErr] = useState("")
  const [data, setData] = useState<{ now: WD; aqi: AD | null; hourly: HH[]; daily: DD[]; city: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const dismiss = Navigation.useDismiss()
  const has = load().length > 0 && loadHost().length > 0

  useEffect(() => {
    const key = load()
    const h = loadHost()
    if (!key || !h) return
    setLoading(true)
    fetchAll(key, h).then(r => { if (r.data) setData(r.data); setApiErr(r.error); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  function doSave() {
    const v = k.trim()
    const hv = normHost(host)
    setHost(hv)
    if (!v) { setErr("请输入 API Key"); return }
    if (v.length < 10) { setErr("Key 格式不正确"); return }
    if (!hv) { setErr("请输入 API Host（控制台-设置中查看）"); return }
    if (!hv.includes(".")) { setErr("API Host 格式不正确，如 abc123.xyz.qweatherapi.com"); return }
    Storage.set(KEY, v)
    Storage.set(HOST, hv)
    setSaved(true); setErr(""); setApiErr("")
    setData(null); setLoading(true)
    fetchAll(v, hv).then(r => { if (r.data) setData(r.data); setApiErr(r.error); setLoading(false) }).catch(() => setLoading(false))
    setTimeout(() => setSaved(false), 2500)
  }

  function doClear() { Storage.remove(KEY); Storage.remove(HOST); setK(""); setHost(""); setSaved(false); setErr(""); setApiErr(""); setData(null) }

  const nd = new Date()
  const n = nd.getHours() < 6 || nd.getHours() >= 18
  const w = data?.now
  const aqi = data?.aqi
  const hourly = data?.hourly || []
  const daily = data?.daily || []
  const city = data?.city || ""
  const t = w ? Math.round(parseFloat(w.temp)) : null
  const f = w ? Math.round(parseFloat(w.feelsLike)) : null

  return (
    <NavigationStack>
      <List
        navigationTitle="和风天气"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        <Section>
          <VStack
            spacing={0}
            frame={{ maxWidth: "infinity" }}
            padding={{ top: 14, leading: 14, bottom: 12, trailing: 14 }}
          >
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text font="headline" foregroundStyle="label" fontWeight="medium">{city || "当前位置"}</Text>
              <Spacer />
              <Text font="callout" foregroundStyle="label" opacity={0.8}>{nd.getFullYear()}年{nd.getMonth()+1}月{nd.getDate()}日 {D[nd.getDay()]}</Text>
            </HStack>
            <Spacer minLength={8} />
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <Image systemName={w ? icon(w.icon, n) : "sun.max.fill"} frame={{ width: 40, height: 40 }} foregroundStyle="label" />
              <HStack alignment="firstTextBaseline" spacing={0}>
                <Text font={52} foregroundStyle="label" fontWeight="regular">{t !== null ? t : "--"}</Text>
                <Text font={20} foregroundStyle="label" opacity={0.5}>°</Text>
              </HStack>
              <Spacer />
              <VStack spacing={0} alignment="trailing">
                <Text font="title2" foregroundStyle="label" fontWeight="semibold">{w ? `${Math.round(parseFloat(w.tempMax))}°` : "--"}</Text>
                <Text font="subheadline" foregroundStyle="label" opacity={0.6}>{w ? `${Math.round(parseFloat(w.tempMin))}°` : "--"}</Text>
              </VStack>
            </HStack>
            <Spacer minLength={6} />
            {aqi ? (
              <HStack spacing={4} background={aqi.color || aqic(aqi.aqi)} padding={{ horizontal: 8, vertical: 2 }}>
                <Text font="caption" foregroundStyle="label" fontWeight="bold">{aqi.aqi}{aqi.category ? ` · ${aqi.category}` : ""}</Text>
                <Spacer />
              </HStack>
            ) : null}
            <Spacer minLength={8} />
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <DetailItem val={f !== null ? `${f}°` : "--"} label="体感" />
              <DetailItem val={w ? `${w.humidity}%` : "--"} label="湿度" />
              <DetailItem val={w ? w.windDir : "--"} label={w ? `${w.windScale}级` : "风向"} />
              <DetailItem val={w ? `${w.vis}km` : "--"} label="能见度" />
              <DetailItem val={w ? `${w.precip}mm` : "--"} label="降水" />
            </HStack>
            <Spacer minLength={8} />
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              {hourly.slice(0, 6).map((h, i) => (
                <VStack key={i} spacing={2} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="caption2" foregroundStyle="label" opacity={0.5}>{i === 0 ? "现在" : h.fxTime.slice(11, 13).replace(/^0/, "") + "时"}</Text>
                  <Image systemName={icon(h.icon, n)} frame={{ width: 14, height: 14 }} foregroundStyle="label" opacity={0.8} />
                  <Text font="caption2" foregroundStyle="label" fontWeight="medium">{Math.round(parseFloat(h.temp))}°</Text>
                </VStack>
              ))}
            </HStack>
            <Spacer minLength={8} />
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              {daily.slice(1, 4).map((d, i) => (
                <VStack key={i} spacing={2} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="caption2" foregroundStyle="label" opacity={0.7} fontWeight="medium">{D2[i]}</Text>
                  <Image systemName={icon(d.iconDay, false)} frame={{ width: 16, height: 16 }} foregroundStyle="label" opacity={0.8} />
                  <HStack spacing={3}>
                    <Text font="caption2" foregroundStyle="label" opacity={0.45}>{Math.round(parseFloat(d.tempMin))}°</Text>
                    <Text font="caption2" foregroundStyle="label" fontWeight="semibold">{Math.round(parseFloat(d.tempMax))}°</Text>
                  </HStack>
                </VStack>
              ))}
            </HStack>
            <Spacer minLength={4} />
            <Text font="footnote" foregroundStyle="label" opacity={0.4} frame={{ maxWidth: "infinity", alignment: "center" }}>
              {loading ? "加载中…" : w ? w.text : (load() && !loadHost()) ? "已保存 Key，还需在下方填写 API Host" : "配置 API Key 和 API Host 后自动加载"}
            </Text>
            {apiErr && !w && !loading ? (
              <Text font="caption" foregroundStyle="systemRed" frame={{ maxWidth: "infinity", alignment: "center" }}>{apiErr}</Text>
            ) : null}
          </VStack>
        </Section>

        <Section
          header={<Text font="headline">API Key 与 API Host</Text>}
          footer={<Text font="caption" foregroundStyle="tertiaryLabel">在和风天气控制台-设置中查看；2026 年起旧公共域名已停用，必须填写你的专属 API Host</Text>}
        >
          <TextField
            title="API Host"
            value={host}
            onChanged={(v) => { setHost(v); setErr("") }}
            prompt="如 abc123.xyz.qweatherapi.com"
          />
          <TextField
            title="API Key"
            value={k}
            onChanged={(v) => { setK(v); setErr("") }}
            prompt="粘贴和风天气 API Key"
          />
          {err ? (
            <HStack spacing={4}>
              <Image systemName="exclamationmark.triangle.fill" frame={{ width: 12, height: 12 }} foregroundStyle="systemRed" />
              <Text font="caption" foregroundStyle="systemRed">{err}</Text>
            </HStack>
          ) : null}
          <Button title={saved ? "已保存 ✓" : "保存"} action={doSave} />
          {has ? <Button title="清除" action={doClear} role="destructive" /> : null}
          {has && !err && !apiErr ? (
            <HStack spacing={6}>
              <Image systemName="checkmark.circle.fill" frame={{ width: 14, height: 14 }} foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="systemGreen">已就绪 {city ? `· ${city}` : ""}</Text>
            </HStack>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<Page />)
  Script.exit()
}

run()
