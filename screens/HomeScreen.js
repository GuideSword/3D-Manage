import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, ROUTES, ORDER_STATUSES } from '../constants';
import { Card } from '../components';
import { ordersAPI } from '../utils/api';

const HomeScreen = () => {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inProgressOrdersCount, setInProgressOrdersCount] = useState(0);

  // 从API获取执行中订单数量
  const fetchInProgressOrdersCount = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) {
        setLoading(true);
      }
      const response = await ordersAPI.getAll({ status: ORDER_STATUSES.IN_PROGRESS });
      const orders = response.items || response || [];
      setInProgressOrdersCount(orders.length);
    } catch (error) {
      console.error('获取执行中订单数量失败:', error);
      // 失败时保持当前数据或设为0
      setInProgressOrdersCount(0);
    } finally {
      setLoading(false);
      if (isRefreshing) {
        setRefreshing(false);
      }
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchInProgressOrdersCount(true);
  };

  useEffect(() => {
    fetchInProgressOrdersCount();
  }, []);

  // 当屏幕获得焦点时刷新数据
  useFocusEffect(
    React.useCallback(() => {
      fetchInProgressOrdersCount();
    }, [])
  );

  const StatCard = ({ title, value, subtitle, color = COLORS.primary }) => (
    <Card style={styles.statCard}>
      <View style={styles.statHeader}>
        <Text style={styles.statTitle}>{title}</Text>
        <View style={[styles.statIndicator, { backgroundColor: color }]} />
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.statSubtitle}>{subtitle}</Text>}
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.welcomeText}>欢迎使用</Text>
          <Text style={styles.appTitle}>3D打印管理系统</Text>
        </View>

        <View style={styles.statsContainer}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              // 导航到订单管理页面，并自动筛选执行中的订单
              navigation.navigate(ROUTES.ORDERS);
            }}
          >
            <StatCard
              title="执行中订单"
              value={loading && !refreshing ? '...' : inProgressOrdersCount}
              subtitle="个订单进行中"
              color={COLORS.primary}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>快捷操作</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={styles.actionCardWrapper}
              onPress={() => {
                // 导航到订单管理页面
                navigation.navigate(ROUTES.ORDERS);
                // TODO: 未来可以打开一个创建订单的modal
              }}
              activeOpacity={0.7}
            >
              <Card style={styles.actionCard}>
                <Text style={styles.actionText}>新建订单</Text>
              </Card>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCardWrapper}
              onPress={() => {
                // 导航到模型管理页面
                navigation.navigate(ROUTES.MODELS);
                // TODO: 未来可以自动打开上传对话框
              }}
              activeOpacity={0.7}
            >
              <Card style={styles.actionCard}>
                <Text style={styles.actionText}>上传模型</Text>
              </Card>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCardWrapper}
              onPress={() => {
                // 导航到耗材管理页面
                navigation.navigate(ROUTES.MATERIALS);
                // TODO: 未来可以切换到库存管理tab
              }}
              activeOpacity={0.7}
            >
              <Card style={styles.actionCard}>
                <Text style={styles.actionText}>库存盘点</Text>
              </Card>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCardWrapper}
              onPress={() => {
                // 导出数据功能
                Alert.alert(
                  '导出数据',
                  '导出功能开发中，即将上线！',
                  [{ text: '确定' }]
                );
                // TODO: 实现导出功能，可以导出订单、库存等数据
              }}
              activeOpacity={0.7}
            >
              <Card style={styles.actionCard}>
                <Text style={styles.actionText}>导出数据</Text>
              </Card>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.recentActivity}>
          <Text style={styles.sectionTitle}>最近活动</Text>
          <Card style={styles.activityCard}>
            <Text style={styles.activityText}>暂无最近活动</Text>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: COLORS.primary,
  },
  welcomeText: {
    fontSize: 16,
    color: COLORS.background,
    opacity: 0.8,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.background,
    marginTop: 4,
  },
  statsContainer: {
    padding: 16,
  },
  statCard: {
    marginBottom: 12,
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  statIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  quickActions: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCardWrapper: {
    width: '48%',
    marginBottom: 12,
  },
  actionCard: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 20,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  recentActivity: {
    padding: 16,
    paddingBottom: 32,
  },
  activityCard: {
    padding: 16,
    alignItems: 'center',
  },
  activityText: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
});

export default HomeScreen;

