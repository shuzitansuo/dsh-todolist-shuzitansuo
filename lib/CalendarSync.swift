import EventKit
import Foundation

let args = CommandLine.arguments
let outPath = args.count > 3 ? args[3] : "/tmp/calendar-sync-out.json"
let formatter = ISO8601DateFormatter()
formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

func finish(_ payload: [String: Any]) -> Never {
  let data = try! JSONSerialization.data(withJSONObject: payload, options: [])
  try! String(data: data, encoding: .utf8)!.write(toFile: outPath, atomically: true, encoding: .utf8)
  exit(0)
}

guard args.count >= 3, let start = formatter.date(from: args[1]), let end = formatter.date(from: args[2]) else {
  finish(["error": "日期参数不合法"])
}

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var granted = false
var accessError: String?
if #available(macOS 14.0, *) {
  store.requestFullAccessToEvents { ok, error in
    granted = ok
    accessError = error?.localizedDescription
    semaphore.signal()
  }
} else {
  store.requestAccess(to: .event) { ok, error in
    granted = ok
    accessError = error?.localizedDescription
    semaphore.signal()
  }
}
_ = semaphore.wait(timeout: .now() + 25)
if !granted {
  finish(["error": accessError ?? "未获得日历访问权限。请在 系统设置 > 隐私与安全性 > 日历 中允许「任务日历同步」访问。"])
}

let skipNames = ["生日", "节假日", "中国大陆节假日", "Siri建议", "Siri 在应用中找到", "计划的提醒事项", "Birthdays", "Holidays"]
let calendars = store.calendars(for: .event)
var names: [String] = []
var result: [[String: Any]] = []

for calendar in calendars {
  let name = calendar.title
  if skipNames.contains(where: { name.localizedCaseInsensitiveContains($0) }) { continue }
  names.append(name)
  let predicate = store.predicateForEvents(withStart: start, end: end, calendars: [calendar])
  let events = store.events(matching: predicate)
  for event in events {
    guard let eventStart = event.startDate, let eventEnd = event.endDate else { continue }
    if eventStart >= end || eventEnd <= start { continue }
    if event.isAllDay { continue }
    result.append([
      "id": event.eventIdentifier ?? "",
      "title": event.title ?? "未命名日程",
      "start": formatter.string(from: eventStart),
      "end": formatter.string(from: eventEnd),
      "allDay": event.isAllDay,
      "calendar": name,
      "location": event.location ?? "",
    ])
  }
}

result.sort { left, right in
  let l = left["start"] as? String ?? ""
  let r = right["start"] as? String ?? ""
  return l < r
}
finish([
  "events": result,
  "calendars": Array(Set(names)).sorted(),
  "syncedAt": formatter.string(from: Date()),
])
