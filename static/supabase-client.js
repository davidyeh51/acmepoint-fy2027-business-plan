/**
 * 進金生能源服務 (6692) · FY2027 董總年度商業計畫與決策戰情室
 * Supabase 雲端資料庫整合客戶端 (Supabase Client Module)
 * 符合 github-supabase-web 規範：僅暴露 anon public key，支援本機離線與雲端雙軌同步
 */

const DEFAULT_SUPABASE_URL = "https://cowljafosekwvxithwjd.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd2xqYWZvc2Vrd3Z4aXRod2pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTYzODcsImV4cCI6MjA5NDIzMjM4N30.c8YXP7EXDeTOw-mJEmnYZ_DJeZv6Qt6HVDzEf8J2K_I";

class SupabasePlanPortalClient {
  constructor() {
    this.url = window.ENV_SUPABASE_URL || localStorage.getItem('SB_URL') || DEFAULT_SUPABASE_URL;
    this.key = window.ENV_SUPABASE_ANON_KEY || localStorage.getItem('SB_ANON_KEY') || DEFAULT_SUPABASE_ANON_KEY;
    this.client = null;
    this.isConnected = false;
    this.user = null;
    this.init();
  }

  init() {
    if (window.supabase && this.url && this.key) {
      try {
        this.client = window.supabase.createClient(this.url, this.key);
      } catch (e) {
        console.warn('[Supabase] Init error:', e);
      }
    }
  }

  saveConfig(newUrl, newKey) {
    this.url = (newUrl || DEFAULT_SUPABASE_URL).trim();
    this.key = (newKey || DEFAULT_SUPABASE_ANON_KEY).trim();
    localStorage.setItem('SB_URL', this.url);
    localStorage.setItem('SB_ANON_KEY', this.key);
    this.init();
  }

  async testConnection() {
    if (!this.client) this.init();
    if (!this.client) return { connected: false, message: 'Supabase SDK 尚未載入' };

    try {
      const { data, error } = await this.client
        .from('fy2027_executive_notes')
        .select('id')
        .limit(1);

      if (error) {
        if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
          this.isConnected = true;
          return {
            connected: true,
            tableReady: false,
            message: '已連線至 Supabase（請於 SQL Editor 執行 supabase-schema.sql 建立 FY2027 專屬資料表）'
          };
        }
        this.isConnected = true;
        return { connected: true, tableReady: false, message: '連線成功 (' + error.message + ')' };
      }

      this.isConnected = true;
      return { connected: true, tableReady: true, message: 'Supabase 雲端資料庫連線正常（RLS 已啟用）' };
    } catch (e) {
      this.isConnected = false;
      return { connected: false, tableReady: false, message: '網路或金鑰異常，目前使用本機離線快取模式' };
    }
  }

  async getCurrentUser() {
    if (!this.client) return null;
    try {
      const { data: { user } } = await this.client.auth.getUser();
      this.user = user;
      return user;
    } catch {
      return null;
    }
  }

  async signIn(email, password) {
    if (!this.client) throw new Error('Supabase 未初始化');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    return data.user;
  }

  async signUp(email, password) {
    if (!this.client) throw new Error('Supabase 未初始化');
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    this.user = data.user;
    return data.user;
  }

  async signOut() {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.user = null;
  }

  async fetchNotes() {
    const localNotes = JSON.parse(localStorage.getItem('FY2027_EXEC_NOTES') || '[]');
    if (!this.client) return localNotes;
    try {
      const { data, error } = await this.client
        .from('fy2027_executive_notes')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        localStorage.setItem('FY2027_EXEC_NOTES', JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn('[Supabase] fetchNotes fallback to local:', e);
    }
    return localNotes;
  }

  async addNote(noteObj) {
    const record = {
      author_name: noteObj.author_name || '董總決策室',
      slide_ref: noteObj.slide_ref || 'Slide 02 - 執行摘要',
      strategy_tag: noteObj.strategy_tag || '資產管理缺口彌平',
      content: noteObj.content,
      sim_snapshot: noteObj.sim_snapshot || null,
      file_url: noteObj.file_url || null,
      user_id: this.user?.id || null,
      created_at: new Date().toISOString()
    };

    const localNotes = JSON.parse(localStorage.getItem('FY2027_EXEC_NOTES') || '[]');
    const localRecord = { ...record, id: Date.now() };
    localNotes.unshift(localRecord);
    localStorage.setItem('FY2027_EXEC_NOTES', JSON.stringify(localNotes));

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('fy2027_executive_notes')
          .insert([record])
          .select();
        if (!error && data && data[0]) {
          localNotes[0] = data[0];
          localStorage.setItem('FY2027_EXEC_NOTES', JSON.stringify(localNotes));
          return { synced: true, data: data[0] };
        }
      } catch (e) {
        console.warn('[Supabase] addNote fallback local:', e);
      }
    }
    return { synced: false, data: localRecord };
  }

  async deleteNote(id) {
    let localNotes = JSON.parse(localStorage.getItem('FY2027_EXEC_NOTES') || '[]');
    localNotes = localNotes.filter(n => n.id !== id);
    localStorage.setItem('FY2027_EXEC_NOTES', JSON.stringify(localNotes));

    if (this.client) {
      try {
        await this.client.from('fy2027_executive_notes').delete().eq('id', id);
      } catch (e) {
        console.warn('[Supabase] deleteNote error:', e);
      }
    }
  }

  async uploadAttachment(file) {
    if (!this.client) throw new Error('Supabase 未初始化');
    const fileExt = file.name.split('.').pop();
    const filePath = `uploads/fy2027_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
    const { error } = await this.client.storage.from('uploads').upload(filePath, file);
    if (error) throw error;
    const { data } = this.client.storage.from('uploads').getPublicUrl(filePath);
    return data.publicUrl;
  }

  async syncFullDatasetToCloud(fyData) {
    if (!this.client || !fyData) return { success: false, message: '無連線或無資料' };
    const results = { opps: 0, carryovers: 0, om: 0, errors: [] };

    try {
      const { error: err1 } = await this.client
        .from('fy2027_bu_opportunities')
        .upsert(fyData.opps, { onConflict: 'id' });
      if (err1) results.errors.push('機會表: ' + err1.message);
      else results.opps = fyData.opps.length;

      const { error: err2 } = await this.client
        .from('fy2027_carryover_projects')
        .upsert(fyData.carryovers, { onConflict: 'id' });
      if (err2) results.errors.push('延續表: ' + err2.message);
      else results.carryovers = fyData.carryovers.length;

      const omRows = [
        ...fyData.om_opps.map(x => ({
          id: `OPP_${x.id}`,
          source_type: '機會預估',
          sub_type: x.sub_type,
          code: x.code_win,
          name: x.name,
          margin_rate: x.margin_rate,
          q1: x.q1, q2: x.q2, q3: x.q3, q4: x.q4,
          rev_2027: x.rev_2027,
          margin_2027: x.margin_2027
        })),
        ...fyData.om_contracts.map(x => ({
          id: `JDE_${x.id}`,
          source_type: 'JDE維運合約',
          sub_type: '長約基盤',
          code: x.code,
          name: x.name,
          margin_rate: x.margin_rate,
          q1: x.q1, q2: x.q2, q3: x.q3, q4: x.q4,
          rev_2027: x.rev_2027,
          margin_2027: x.margin_2027
        }))
      ];
      const { error: err3 } = await this.client
        .from('fy2027_om_budget')
        .upsert(omRows, { onConflict: 'id' });
      if (err3) results.errors.push('維運表: ' + err3.message);
      else results.om = omRows.length;

      return {
        success: results.errors.length === 0,
        results,
        message: results.errors.length === 0
          ? `已成功同步 ${results.opps} 筆機會、${results.carryovers} 筆延續專案、${results.om} 筆維運預算至 Supabase 雲端！`
          : `部分同步異常：${results.errors.join(' / ')}`
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
}

window.sbPortal = new SupabasePlanPortalClient();
