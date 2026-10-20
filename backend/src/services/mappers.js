function toSpace(row, config) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    typeLabel: config.TYPE_LABELS[row.type],
    capacity: row.capacity,
    location: row.location,
    active: !!row.active,
  };
}

// "finished" = la reserva ya terminó (no se puede liberar si ya pasó, salvo ALLOW_PAST).
function toReservation(row, now) {
  return {
    id: row.id,
    spaceId: row.space_id,
    userId: row.user_id || null,
    spaceName: row.space_name,
    spaceType: row.space_type,
    date: row.date,
    startHour: row.start_hour,
    endHour: row.end_hour,
    responsibleName: row.responsible_name,
    role: row.role,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    finished: row.date < now.date || (row.date === now.date && row.end_hour <= now.hour),
  };
}

module.exports = { toSpace, toReservation };
