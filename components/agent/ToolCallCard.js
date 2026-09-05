import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

// Collapsible card showing one tool call from the Agent.
//
//   name:   tool function name (e.g. 'query_orders')
//   args:   arguments object passed to the tool
//   result: optional result object returned by the tool (when set, the
//           status icon flips from '…' to '✓').

export default function ToolCallCard({ name, args, result }) {
  const [open, setOpen] = useState(false);
  const done = Boolean(result);
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setOpen(!open)} activeOpacity={0.7}>
        <View style={styles.header}>
          <Text style={styles.title}>
            🔧 {name || 'tool'}
          </Text>
          <Text style={[styles.status, done ? styles.ok : styles.pending]}>
            {done ? '✓' : '…'}
          </Text>
        </View>
      </TouchableOpacity>
      {open ? (
        <View style={styles.body}>
          <Text style={styles.label}>参数：</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.code}>{safeStringify(args, 2)}</Text>
          </ScrollView>
          {result !== undefined && result !== null ? (
            <>
              <Text style={[styles.label, { marginTop: 6 }]}>结果：</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text style={styles.code}>{safeStringify(result, 2).slice(0, 800)}</Text>
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function safeStringify(value, indent) {
  try {
    return JSON.stringify(value, null, indent);
  } catch (_) {
    return String(value);
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF8E1',
    marginHorizontal: 8,
    marginVertical: 4,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 13, color: '#5D4037', fontWeight: '600' },
  status: { fontSize: 14, marginLeft: 8 },
  ok: { color: '#2E7D32' },
  pending: { color: '#B45309' },
  body: { marginTop: 8 },
  label: { fontSize: 12, color: '#666', marginBottom: 2 },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#333',
  },
});
