# frozen_string_literal: true

# Postal, for Xooteq Mail. A small JSON API on the platform's private Docker
# network that lists and changes Postal's apps (its "mail servers"), their
# sending domains, SMTP/API keys, message log and suppression lists, so the
# dashboard is the one place to run everything.
#
# It runs inside Postal's own image (docker-compose.yml, service postal-bridge)
# and does every change through Postal's models, so keys, DKIM keys, message
# databases and DNS checks are made exactly as Postal's web interface makes them.
# Nothing is published to the internet; every request needs POSTAL_BRIDGE_SECRET.

APP_ROOT = ENV.fetch("POSTAL_APP_ROOT", "/opt/postal/app")
Dir.chdir(APP_ROOT)
require File.join(APP_ROOT, "config/environment")
require "json"
require "puma"
require "openssl"

SECRET = ENV.fetch("POSTAL_BRIDGE_SECRET", "")
abort "POSTAL_BRIDGE_SECRET is not set" if SECRET.length < 24
BIND = ENV.fetch("POSTAL_BRIDGE_BIND", "0.0.0.0")
PORT = ENV.fetch("POSTAL_BRIDGE_PORT", "5010").to_i

class Fail < StandardError

  attr_reader :status

  def initialize(message, status = 400)
    super(message)
    @status = status
  end

end

def time(value)
  value&.utc&.iso8601
end

# Postal's message database gives 1/0 for some flags and true/false for others.
def flag(value)
  [true, 1, "1"].include?(value)
end

def organization
  wanted = ENV["POSTAL_BRIDGE_ORG"].to_s
  scope = Organization.present
  org = wanted.empty? ? scope.order(:id).first : scope.find_by(permalink: wanted)
  raise Fail.new("Postal has no organization yet. Make one in Postal's own admin first.", 409) unless org

  org
end

def find_server(permalink)
  organization.servers.present.find_by(permalink: permalink) || raise(Fail.new("No such app.", 404))
end

# Sums over the last hours or days, for the overview.
def server_stats(server)
  db = server.message_db
  hourly = db.statistics.get(:hourly, [:outgoing, :bounces, :incoming], Time.now.utc, 24)
  daily = db.statistics.get(:daily, [:outgoing, :bounces], Time.now.utc, 14)
  {
    sent24h: hourly.sum { |_, s| s[:outgoing].to_i },
    bounced24h: hourly.sum { |_, s| s[:bounces].to_i },
    received24h: hourly.sum { |_, s| s[:incoming].to_i },
    held: server.held_messages,
    queued: server.queue_size,
    bounceRate: server.bounce_rate.to_f.round(2),
    daily: daily.map { |t, s| { day: t.to_date.iso8601, sent: s[:outgoing].to_i, bounced: s[:bounces].to_i } }
  }
rescue StandardError => e
  { statsError: e.message }
end

def server_json(server, full: false)
  h = {
    id: server.permalink,
    name: server.name,
    mode: server.mode,
    suspended: server.suspended?,
    smtpUsername: server.full_permalink,
    domains: server.domains.count,
    credentials: server.credentials.count
  }
  h.merge!(server_stats(server))
  if full
    h[:domainList] = server.domains.order(:name).map { |d| domain_json(d) }
    h[:credentialList] = server.credentials.order(:created_at).map { |c| credential_json(c) }
  end
  h
end

def relative(host, domain)
  return "@" if host == domain

  host.end_with?(".#{domain}") ? host.delete_suffix(".#{domain}") : host
end

def domain_json(domain)
  {
    id: domain.uuid,
    name: domain.name,
    verified: domain.verified?,
    checkedAt: time(domain.dns_checked_at),
    status: {
      spf: { status: domain.spf_status, error: domain.spf_error },
      dkim: { status: domain.dkim_status, error: domain.dkim_error },
      returnPath: { status: domain.return_path_status, error: domain.return_path_error },
      mx: { status: domain.mx_status, error: domain.mx_error }
    },
    records: [
      { kind: "SPF", type: "TXT", host: "@", value: domain.spf_record, required: true,
        why: "Lets this platform send as #{domain.name}. One SPF record per domain: merge it into an existing one." },
      { kind: "DKIM", type: "TXT", host: domain.dkim_record_name, value: domain.dkim_record, required: true,
        why: "Signs what your apps send, so receivers can tell it is genuine." },
      { kind: "Return path", type: "CNAME", host: relative(domain.return_path_domain, domain.name), value: Postal::Config.dns.return_path_domain, required: true,
        why: "Bounces come back here, so dead addresses are noticed and stopped." },
      { kind: "MX", type: "MX", host: "@", value: Array(Postal::Config.dns.mx_records).first, priority: 10, required: false,
        why: "Only to receive replies here. The domain's Xooteq Mail company uses this same MX." }
    ]
  }
end

def credential_json(credential)
  {
    id: credential.id,
    name: credential.name,
    type: credential.type,
    key: credential.key,
    hold: credential.hold,
    lastUsedAt: time(credential.last_used_at),
    createdAt: time(credential.created_at)
  }
end

def message_json(message, full: false)
  h = {
    id: message.id,
    token: message.token,
    scope: message.scope,
    to: message.rcpt_to,
    from: message.mail_from,
    subject: message.subject,
    status: message.status,
    held: message.held?,
    spam: flag(message.spam),
    bounce: flag(message.bounce),
    tag: message.tag,
    timestamp: time(message.timestamp),
    lastDeliveryAttempt: time(message.last_delivery_attempt)
  }
  if full
    h[:deliveries] = message.deliveries.map do |d|
      { status: d.status, details: d.details, output: d.output, sentWithSsl: flag(d.sent_with_ssl), time: d.time, timestamp: time(d.timestamp) }
    end
    h[:raw] = message.raw_message?
    h[:body] = begin
      message.plain_body.to_s[0, 20_000]
    rescue StandardError
      nil
    end
    h[:messageId] = message.message_id
    h[:queued] = !message.queued_message.nil?
  end
  h
end

def messages(server, params)
  scope = params["scope"].to_s
  options = if scope == "held"
              { where: { held: true }, order: :timestamp, direction: "desc" }
            else
              { where: { scope: scope == "incoming" ? "incoming" : "outgoing", spam: false }, order: :timestamp, direction: "desc" }
            end
  options[:where][:rcpt_to] = params["to"].strip if params["to"].to_s.strip != ""
  options[:where][:mail_from] = params["from"].strip if params["from"].to_s.strip != ""
  options[:where][:status] = params["status"] if params["status"].to_s != ""
  page = server.message_db.messages_with_pagination(params["page"].to_i, options.merge(per_page: 40))
  { messages: page[:records].map { |m| message_json(m) }, page: page[:page], totalPages: page[:total_pages], total: page[:total] }
end

def find_message(server, id)
  server.message_db.message(id.to_i)
rescue Postal::MessageDB::Message::NotFound
  raise Fail.new("That message is gone.", 404)
end

def body_of(env)
  raw = env["rack.input"].read
  raw.to_s.empty? ? {} : JSON.parse(raw)
rescue JSON::ParserError
  raise Fail.new("The request was not JSON.")
end

ROUTES = [
  ["GET", %r{\A/health\z}, ->(_m, _b, _q) { { ok: true } }],
  ["GET", %r{\A/overview\z}, lambda { |_m, _b, _q|
    org = organization
    { organization: { name: org.name, permalink: org.permalink },
      smtp: { host: Postal::Config.postal.smtp_hostname, port: 587, security: "STARTTLS" },
      api: { url: "#{Postal::Config.postal.web_protocol}://#{Postal::Config.postal.web_hostname}/api/v1/send/message", header: "X-Server-API-Key" },
      dns: { spfInclude: Postal::Config.dns.spf_include, returnPath: Postal::Config.dns.return_path_domain },
      servers: org.servers.present.order(:name).map { |s| server_json(s) } }
  }],
  ["POST", %r{\A/servers\z}, lambda { |_m, b, _q|
    name = b["name"].to_s.strip
    raise Fail, "Give the app a name." if name.empty?

    server = organization.servers.create!(name: name, mode: b["mode"] == "Development" ? "Development" : "Live")
    server_json(server, full: true)
  }],
  ["GET", %r{\A/servers/([a-z0-9-]+)\z}, ->(m, _b, _q) { server_json(find_server(m[1]), full: true) }],
  ["PATCH", %r{\A/servers/([a-z0-9-]+)\z}, lambda { |m, b, _q|
    server = find_server(m[1])
    server.name = b["name"].to_s.strip if b["name"].to_s.strip != ""
    server.mode = b["mode"] if %w[Live Development].include?(b["mode"])
    server.save!
    server_json(server, full: true)
  }],
  ["DELETE", %r{\A/servers/([a-z0-9-]+)\z}, lambda { |m, _b, _q|
    find_server(m[1]).soft_destroy
    { ok: true }
  }],
  ["POST", %r{\A/servers/([a-z0-9-]+)/domains\z}, lambda { |m, b, _q|
    server = find_server(m[1])
    domain = server.domains.build(name: b["name"].to_s.strip.downcase, verification_method: "DNS")
    domain.verified_at = Time.now # our own domains: no ownership check, like a Postal admin
    domain.save!
    begin
      domain.check_dns(:manual)
    rescue StandardError
      nil
    end
    domain_json(domain.reload)
  }],
  ["POST", %r{\A/servers/([a-z0-9-]+)/domains/([a-f0-9-]+)/check\z}, lambda { |m, _b, _q|
    domain = find_server(m[1]).domains.find_by!(uuid: m[2])
    domain.check_dns(:manual)
    domain_json(domain.reload)
  }],
  ["DELETE", %r{\A/servers/([a-z0-9-]+)/domains/([a-f0-9-]+)\z}, lambda { |m, _b, _q|
    find_server(m[1]).domains.find_by!(uuid: m[2]).destroy
    { ok: true }
  }],
  ["POST", %r{\A/servers/([a-z0-9-]+)/credentials\z}, lambda { |m, b, _q|
    type = %w[SMTP API].include?(b["type"]) ? b["type"] : "SMTP"
    name = b["name"].to_s.strip
    raise Fail, "Name the key after what uses it, e.g. supabase." if name.empty?

    credential_json(find_server(m[1]).credentials.create!(name: name, type: type))
  }],
  ["PATCH", %r{\A/servers/([a-z0-9-]+)/credentials/(\d+)\z}, lambda { |m, b, _q|
    credential = find_server(m[1]).credentials.find(m[2].to_i)
    credential.name = b["name"].to_s.strip if b["name"].to_s.strip != ""
    credential.hold = !!b["hold"] if b.key?("hold")
    credential.save!
    credential_json(credential)
  }],
  ["DELETE", %r{\A/servers/([a-z0-9-]+)/credentials/(\d+)\z}, lambda { |m, _b, _q|
    find_server(m[1]).credentials.find(m[2].to_i).destroy
    { ok: true }
  }],
  ["GET", %r{\A/servers/([a-z0-9-]+)/messages\z}, ->(m, _b, q) { messages(find_server(m[1]), q) }],
  ["GET", %r{\A/servers/([a-z0-9-]+)/messages/(\d+)\z}, ->(m, _b, _q) { message_json(find_message(find_server(m[1]), m[2]), full: true) }],
  ["POST", %r{\A/servers/([a-z0-9-]+)/messages/(\d+)/retry\z}, lambda { |m, _b, _q|
    message = find_message(find_server(m[1]), m[2])
    raise Fail, "This message is no longer stored, so it cannot be sent again." unless message.raw_message?

    if message.queued_message
      message.queued_message.retry_now
    else
      message.add_to_message_queue(manual: true)
    end
    message_json(find_message(find_server(m[1]), m[2]), full: true)
  }],
  ["POST", %r{\A/servers/([a-z0-9-]+)/messages/(\d+)/cancel-hold\z}, lambda { |m, _b, _q|
    find_message(find_server(m[1]), m[2]).cancel_hold
    message_json(find_message(find_server(m[1]), m[2]), full: true)
  }],
  ["GET", %r{\A/servers/([a-z0-9-]+)/suppressions\z}, lambda { |m, _b, q|
    page = find_server(m[1]).message_db.suppression_list.all_with_pagination(q["page"].to_i)
    { suppressions: page[:records].map { |s| { type: s["type"], address: s["address"], reason: s["reason"], since: time(Time.zone.at(s["timestamp"].to_f)), until: time(Time.zone.at(s["keep_until"].to_f)) } },
      page: page[:page], totalPages: page[:total_pages], total: page[:total] }
  }],
  ["DELETE", %r{\A/servers/([a-z0-9-]+)/suppressions\z}, lambda { |m, _b, q|
    removed = find_server(m[1]).message_db.suppression_list.remove(q["type"].presence || "recipient", q["address"].to_s)
    { ok: removed }
  }],
  ["POST", %r{\A/servers/([a-z0-9-]+)/test\z}, lambda { |m, b, _q|
    server = find_server(m[1])
    message = OutgoingMessagePrototype.new(server, "127.0.0.1", "xooteq-mail", {
      from: b["from"], to: b["to"], subject: b["subject"].presence || "Test from Xooteq Mail",
      plain_body: b["body"].presence || "This is a test message sent from Xooteq Mail."
    })
    result = message.create_messages
    unless result
      plain = {
        "NoRecipients" => "add someone to send it to",
        "NoContent" => "write something in it",
        "FromAddressMissing" => "add a From address",
        "UnauthenticatedFromAddress" => "the From address must be on one of this app's domains (add the domain under Domains)",
        "TooManyToAddresses" => "too many recipients"
      }
      errors = message.errors.respond_to?(:full_messages) ? message.errors.full_messages : Array(message.errors)
      raise Fail, "Not sent: #{errors.map { |e| plain[e] || e }.join(', ').presence || 'Postal refused it'}."
    end

    { queued: result.map { |address, r| { to: address, id: r[:id], token: r[:token] } } }
  }]
].freeze

def authorised?(env)
  given = env["HTTP_X_BRIDGE_KEY"].to_s
  given.bytesize == SECRET.bytesize && OpenSSL.fixed_length_secure_compare(given, SECRET)
end

APP = lambda do |env|
  reply = ->(status, obj) { [status, { "content-type" => "application/json" }, [JSON.generate(obj)]] }
  return reply.call(401, { error: "Not allowed." }) unless authorised?(env)

  method = env["REQUEST_METHOD"]
  path = env["PATH_INFO"]
  query = Rack::Utils.parse_nested_query(env["QUERY_STRING"])
  route = ROUTES.find { |m, re, _| m == method && path.match?(re) }
  return reply.call(404, { error: "Not found." }) unless route

  ActiveRecord::Base.connection_pool.with_connection do
    reply.call(200, route[2].call(path.match(route[1]), method == "GET" ? {} : body_of(env), query))
  end
rescue Fail => e
  reply.call(e.status, { error: e.message })
rescue ActiveRecord::RecordInvalid => e
  reply.call(400, { error: e.record.errors.full_messages.join(", ") })
rescue ActiveRecord::RecordNotFound
  reply.call(404, { error: "Not found." })
rescue StandardError => e
  warn "[postal-bridge] #{e.class}: #{e.message}\n#{e.backtrace&.first(5)&.join("\n")}"
  reply.call(500, { error: "Postal could not do that (#{e.class})." })
end

server = Puma::Server.new(APP, nil, { min_threads: 0, max_threads: 4 })
server.add_tcp_listener(BIND, PORT)
warn "[postal-bridge] listening on #{BIND}:#{PORT}"
server.run.join
