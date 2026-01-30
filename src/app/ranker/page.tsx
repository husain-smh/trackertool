'use client';

import { useState, useEffect, KeyboardEvent } from 'react';
import Navbar from '@/components/Navbar';
import { RefreshCw, Trash2 } from 'lucide-react';

interface ImportantPerson {
  username: string;
  user_id: string;
  name: string;
  last_synced: string | null;
  following_count: number;
  is_active: boolean;
  weight?: number;
  networth?: number;
  tags?: string[];
}

interface ImportantAccountCandidate {
  followed_username: string;
  followed_user_id: string;
  follower_count: number;
  total_weight: number;
  importance_score: number;
  sample_followed_by: {
    username: string;
    user_id: string;
    name: string;
    weight?: number;
  }[];
}

interface SyncStatus {
  username: string;
  user_id: string;
  name: string;
  last_synced: string | null;
  following_count: number;
  sync_status: 'never_synced' | 'synced';
}

interface AccountImportanceResult {
  id: string; // unique ID for removal
  username: string;
  found: boolean;
  followed_username?: string;
  followed_user_id?: string;
  importance_score: number;
  followed_by: Array<{
    username: string;
    user_id: string;
    name: string;
    weight: number;
  }>;
}

export default function RankerAdmin() {
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [syncingUsername, setSyncingUsername] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { type: 'sync' | 'remove'; username: string }
    | null
  >(null);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [importantPeople, setImportantPeople] = useState<ImportantPerson[]>([]);
  const [weightEdits, setWeightEdits] = useState<Record<string, string>>({});
  const [updatingWeight, setUpdatingWeight] = useState<string | null>(null);
  const [networthEdits, setNetworthEdits] = useState<Record<string, string>>({});
  const [updatingNetworth, setUpdatingNetworth] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    summary: {
      total_people: number;
      synced_people: number;
      unsynced_people: number;
      oldest_sync: string | null;
      newest_sync: string | null;
    };
    people: SyncStatus[];
  } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPeople, setTotalPeople] = useState(0);
  const [limit] = useState(20);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [allPeople, setAllPeople] = useState<ImportantPerson[]>([]); // Store all people for search/tag filters
  const [hasLoadedAllPeople, setHasLoadedAllPeople] = useState(false);
  const [isFetchingAllPeople, setIsFetchingAllPeople] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isCandidateModalOpen, setIsCandidateModalOpen] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateList, setCandidateList] = useState<ImportantAccountCandidate[]>([]);
  const [candidateAdding, setCandidateAdding] = useState<Record<string, boolean>>({});
  const [candidateMinFollowers, setCandidateMinFollowers] = useState(3);
  const [candidateMinWeight, setCandidateMinWeight] = useState(0);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [isBatchAdding, setIsBatchAdding] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isFetchingTags, setIsFetchingTags] = useState(false);
  const [tagModalPerson, setTagModalPerson] = useState<ImportantPerson | null>(null);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagInputValue, setTagInputValue] = useState('');
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const [syncFilter, setSyncFilter] = useState<'all' | 'synced' | 'unsynced'>('all');
  const [isLoadingTagFilterData, setIsLoadingTagFilterData] = useState(false);
  
  // Check Important Score section state
  const [checkUsername, setCheckUsername] = useState('');
  const [isCheckLoading, setIsCheckLoading] = useState(false);
  const [isCheckSectionOpen, setIsCheckSectionOpen] = useState(false);
  const [checkResults, setCheckResults] = useState<AccountImportanceResult[]>([]);
  
  const clearAllPeopleCache = () => {
    setAllPeople([]);
    setHasLoadedAllPeople(false);
  };

  // Fetch important people on mount
  useEffect(() => {
    fetchImportantPeople();
    fetchSyncStatus();
    fetchAvailableTags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch all people for search/tag filtering
  const fetchAllPeople = async (reason: 'search' | 'filter' = 'search') => {
    if (hasLoadedAllPeople || isFetchingAllPeople) {
      return;
    }

    if (reason === 'search') {
      setIsSearching(true);
    } else {
      setIsLoadingTagFilterData(true);
    }

    setIsFetchingAllPeople(true);

    try {
      const response = await fetch(`/api/ranker/admin/important-people?page=1&limit=1000`);
      const data = await response.json();
      
      if (response.ok && data.success) {
        setAllPeople(
          data.data.people.map((person: ImportantPerson) => ({
            ...person,
            tags: person.tags ?? [],
          }))
        );
        setHasLoadedAllPeople(true);
      }
    } catch (error) {
      console.error('Error fetching all people:', error);
    } finally {
      setIsFetchingAllPeople(false);
      if (reason === 'search') {
        setIsSearching(false);
      } else {
        setIsLoadingTagFilterData(false);
      }
    }
  };

  // Trigger search when query changes (with debounce)
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed) {
      if (!hasLoadedAllPeople) {
        const timeoutId = setTimeout(() => {
          fetchAllPeople('search');
        }, 300); // 300ms debounce
        return () => clearTimeout(timeoutId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, hasLoadedAllPeople]);

  // Ensure full dataset is available when filtering by tags
  useEffect(() => {
    if (selectedTags.length > 0 && !hasLoadedAllPeople) {
      fetchAllPeople('filter');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTags, hasLoadedAllPeople]);

  const requiresFullDataset = searchQuery.trim().length > 0 || selectedTags.length > 0;
  const baseList =
    requiresFullDataset && hasLoadedAllPeople ? allPeople : importantPeople;
  const isAwaitingFullDataset =
    requiresFullDataset && !hasLoadedAllPeople && (isSearching || isLoadingTagFilterData);

  // Combined filters for search, tags, and sync status
  const filteredPeople = baseList.filter((person) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      person.username.toLowerCase().includes(query) ||
      person.name?.toLowerCase().includes(query);

    const personTags = person.tags ?? [];
    const matchesTags =
      selectedTags.length === 0 ||
      selectedTags.every((tag) =>
        personTags.some((personTag) => personTag.toLowerCase() === tag.toLowerCase())
      );

    const isSynced = person.last_synced !== null;
    const matchesSync =
      syncFilter === 'all' ? true : syncFilter === 'synced' ? isSynced : !isSynced;

    return matchesSearch && matchesTags && matchesSync;
  });

  const unsyncedCount = filteredPeople.filter((person) => person.last_synced === null).length;

  const fetchImportantPeople = async (page: number = currentPage) => {
    setIsFetching(true);
    try {
      const response = await fetch(`/api/ranker/admin/important-people?page=${page}&limit=${limit}`);
      const data = await response.json();
      
      if (response.ok && data.success) {
        setImportantPeople(
          data.data.people.map((person: ImportantPerson) => ({
            ...person,
            tags: person.tags ?? [],
          }))
        );
        setTotalPages(data.data.pagination.total_pages);
        setTotalPeople(data.data.pagination.total);
        setCurrentPage(page);
        setWeightEdits({});
        setNetworthEdits({});
      }
    } catch (error) {
      console.error('Error fetching important people:', error);
    } finally {
      setIsFetching(false);
    }
  };

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch('/api/ranker/admin/sync-status');
      const data = await response.json();
      
      if (response.ok && data.success) {
        setSyncStatus(data.data);
      }
    } catch (error) {
      console.error('Error fetching sync status:', error);
    }
  };

  const fetchAvailableTags = async () => {
    setIsFetchingTags(true);
    try {
      const response = await fetch('/api/ranker/admin/important-tags');
      const data = await response.json();
      if (response.ok && data.success) {
        setAvailableTags(data.data.tags);
      }
    } catch (error) {
      console.error('Error fetching available tags:', error);
    } finally {
      setIsFetchingTags(false);
    }
  };

  const handleCheckImportance = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!checkUsername.trim()) {
      return;
    }

    setIsCheckLoading(true);

    try {
      const usernameToCheck = checkUsername.trim().replace(/^@/, '');
      const response = await fetch(`/api/ranker/account-importance?username=${encodeURIComponent(usernameToCheck)}`);
      const data = await response.json();

      if (response.ok && data.success) {
        const result: AccountImportanceResult = {
          id: `${usernameToCheck}-${Date.now()}`, // unique ID for removal
          username: usernameToCheck,
          found: data.data.found,
          followed_username: data.data.followed_username,
          followed_user_id: data.data.followed_user_id,
          importance_score: data.data.importance_score,
          followed_by: data.data.followed_by || [],
        };
        
        // Add result to the list (allows multiple checks)
        setCheckResults((prev) => [result, ...prev]);
        setCheckUsername(''); // Clear input after successful check
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to check importance score',
        });
      }
    } catch (error) {
      console.error('Error checking importance:', error);
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsCheckLoading(false);
    }
  };

  const handleRemoveResult = (resultId: string) => {
    setCheckResults((prev) => prev.filter((result) => result.id !== resultId));
  };

  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      setMessage({
        type: 'error',
        text: 'Please enter a username',
      });
      return;
    }

    // Client-side duplicate check
    const usernameToAdd = username.trim().toLowerCase();
    const existingPerson = importantPeople.find(
      (person) => person.username.toLowerCase() === usernameToAdd
    );
    
    if (existingPerson) {
      setMessage({
        type: 'error',
        text: `@${username.trim()} is already in your important people list!`,
      });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/ranker/admin/important-person', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Handle multiple username additions
        const summary = data.summary;
        if (summary && summary.total > 1) {
          setMessage({
            type: 'success',
            text: `${summary.added} of ${summary.total} people added successfully${summary.failed > 0 ? ` (${summary.failed} duplicates found)` : ''}`,
          });
        } else {
          setMessage({
            type: 'success',
            text: data.message || 'Important person added.',
          });
        }
        setUsername('');
        clearAllPeopleCache(); // Clear search cache to include new person
        fetchImportantPeople(1); // Reset to page 1 after adding
        fetchSyncStatus();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to add important person',
        });
      }
    } catch (error) {
      console.error('Error:', error);
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemovePerson = async (username: string) => {
    try {
      const response = await fetch(`/api/ranker/admin/important-person?username=${username}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMessage({
          type: 'success',
          text: `@${username} removed successfully`,
        });
        clearAllPeopleCache(); // Clear search cache after removal
        fetchImportantPeople();
        fetchSyncStatus();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to remove person',
        });
      }
    } catch (error) {
      console.error('Error:', error);
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    }
  };

  const handleSyncPerson = async (username: string) => {
    // Prevent multiple syncs at once
    if (syncingUsername) {
      setMessage({
        type: 'error',
        text: `Please wait for @${syncingUsername} to finish syncing first.`,
      });
      return;
    }

    setSyncingUsername(username);
    setMessage({
      type: 'success',
      text: `Syncing @${username}...`,
    });

    try {
      // Create an AbortController with a longer timeout (5 minutes for sync operations)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

      const response = await fetch('/api/ranker/admin/sync-person', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (response.ok && data.success) {
        // Handle multiple usernames response
        const summary = data.summary;
        if (summary && summary.total > 1) {
          setMessage({
            type: 'success',
            text: `${summary.succeeded} of ${summary.total} synced successfully!`,
          });
        } else {
          setMessage({
            type: 'success',
            text: `@${username} synced successfully!`,
          });
        }
        clearAllPeopleCache(); // Clear search cache after sync (data might have changed)
        fetchImportantPeople();
        fetchSyncStatus();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to sync person',
        });
      }
    } catch (error) {
      console.error('Error:', error);
      if ((error as Error).name === 'AbortError') {
        setMessage({
          type: 'error',
          text: 'Sync operation timed out. The person may have too many followers. Please try again.',
        });
      } else {
        setMessage({
          type: 'error',
          text: 'Network error. Please try again.',
        });
      }
    } finally {
      setSyncingUsername(null);
    }
  };

  const updatePeopleWeight = (list: ImportantPerson[], username: string, weight: number) =>
    list.map((person) =>
      person.username === username ? { ...person, weight } : person
    );

  const updatePeopleNetworth = (list: ImportantPerson[], username: string, networth: number | null) =>
    list.map((person) =>
      person.username === username ? { ...person, networth: networth ?? undefined } : person
    );

  const updatePeopleTags = (list: ImportantPerson[], username: string, tags: string[]) =>
    list.map((person) =>
      person.username === username ? { ...person, tags } : person
    );

  const handleWeightInputChange = (username: string, value: string) => {
    setWeightEdits((prev) => ({
      ...prev,
      [username]: value,
    }));
  };

  const handleWeightSave = async (person: ImportantPerson) => {
    const inputValue =
      weightEdits[person.username] ?? (person.weight ?? 1).toString();
    const parsedWeight = Number(inputValue);

    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setMessage({
        type: 'error',
        text: 'Weight must be a positive number',
      });
      return;
    }

    if (Math.abs(parsedWeight - (person.weight ?? 1)) < 0.0001) {
      return; // No change
    }

    setUpdatingWeight(person.username);

    try {
      const response = await fetch('/api/ranker/admin/important-person', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: person.username,
          weight: parsedWeight,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMessage({
          type: 'success',
          text: `@${person.username} weight updated`,
        });
        setImportantPeople((prev) => updatePeopleWeight(prev, person.username, parsedWeight));
        setAllPeople((prev) => updatePeopleWeight(prev, person.username, parsedWeight));
        setWeightEdits((prev) => {
          const next = { ...prev };
          delete next[person.username];
          return next;
        });
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to update weight',
        });
      }
    } catch (error) {
      console.error('Error updating weight:', error);
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setUpdatingWeight(null);
    }
  };

  const handleNetworthInputChange = (username: string, value: string) => {
    setNetworthEdits((prev) => ({
      ...prev,
      [username]: value,
    }));
  };

  const handleNetworthSave = async (person: ImportantPerson) => {
    const inputValue = networthEdits[person.username] ?? (person.networth !== undefined ? person.networth.toString() : '');
    const trimmedValue = inputValue.trim();
    
    // Allow empty string to clear networth
    let parsedNetworth: number | null;
    if (trimmedValue === '') {
      parsedNetworth = null;
    } else {
      parsedNetworth = Number(trimmedValue);
      if (!Number.isFinite(parsedNetworth) || parsedNetworth < 0) {
        setMessage({
          type: 'error',
          text: 'Networth must be a non-negative number or empty to clear',
        });
        return;
      }
    }

    // Check if value actually changed
    const currentNetworth = person.networth ?? null;
    if (parsedNetworth === currentNetworth) {
      return; // No change
    }

    setUpdatingNetworth(person.username);

    try {
      const response = await fetch('/api/ranker/admin/important-person', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: person.username,
          networth: parsedNetworth,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMessage({
          type: 'success',
          text: `@${person.username} networth updated`,
        });
        setImportantPeople((prev) => updatePeopleNetworth(prev, person.username, parsedNetworth));
        setAllPeople((prev) => updatePeopleNetworth(prev, person.username, parsedNetworth));
        setNetworthEdits((prev) => {
          const next = { ...prev };
          delete next[person.username];
          return next;
        });
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to update networth',
        });
      }
    } catch (error) {
      console.error('Error updating networth:', error);
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setUpdatingNetworth(null);
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Never synced';
    return new Date(date).toLocaleString();
  };

  const getTimeSince = (date: string | null) => {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const fetchCandidates = async () => {
    setCandidateLoading(true);
    setCandidateError(null);
    setSelectedCandidates([]);
    try {
      const params = new URLSearchParams({
        minFollowers: String(candidateMinFollowers),
        minWeight: String(candidateMinWeight),
      });
      const response = await fetch(`/api/ranker/admin/important-candidates?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load candidates');
      }
      setCandidateList(data.data.candidates);
    } catch (error) {
      console.error('Error fetching candidates:', error);
      setCandidateError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setCandidateLoading(false);
    }
  };

  const openCandidateModal = () => {
    setIsCandidateModalOpen(true);
    if (candidateList.length === 0) {
      fetchCandidates();
    }
  };

  const closeCandidateModal = () => {
    setIsCandidateModalOpen(false);
  };

  const handleAddCandidate = async (candidate: ImportantAccountCandidate) => {
    await addCandidates([candidate.followed_username], candidate.followed_username);
  };

  const addCandidates = async (usernames: string[], trackingKey?: string) => {
    if (usernames.length === 0) {
      return;
    }

    if (trackingKey) {
      setCandidateAdding((prev) => ({ ...prev, [trackingKey]: true }));
    } else {
      setIsBatchAdding(true);
    }

    setMessage({
      type: 'success',
      text: usernames.length === 1
        ? `Adding @${usernames[0]}...`
        : `Adding ${usernames.length} candidates...`,
    });

    try {
      const response = await fetch('/api/ranker/admin/important-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const firstError = data?.results?.find((r: { success: boolean }) => !r.success)?.error;
        throw new Error(data.error || firstError || 'Failed to add candidate(s)');
      }

      const addedUsernames: string[] = data.results
        ?.filter((result: { success: boolean }) => result.success)
        .map((result: { username: string }) => result.username) ?? usernames;

      setMessage({
        type: 'success',
        text: usernames.length === 1
          ? `@${usernames[0]} added.`
          : `${addedUsernames.length} candidates added.`,
      });

      setCandidateList((prev) =>
        prev.filter((item) => !addedUsernames.includes(item.followed_username))
      );
      setSelectedCandidates((prev) => prev.filter((name) => !addedUsernames.includes(name)));
      clearAllPeopleCache(); // ensure future fetch reflects new person
      fetchImportantPeople(1);
      fetchSyncStatus();
    } catch (error) {
      console.error('Error adding candidate(s):', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to add candidate(s)',
      });
    } finally {
      if (trackingKey) {
        setCandidateAdding((prev) => {
          const next = { ...prev };
          delete next[trackingKey];
          return next;
        });
      } else {
        setIsBatchAdding(false);
      }
    }
  };

  const handleBatchAdd = () => {
    addCandidates(selectedCandidates);
  };

  const toggleCandidateSelection = (username: string) => {
    setSelectedCandidates((prev) =>
      prev.includes(username)
        ? prev.filter((item) => item !== username)
        : [...prev, username]
    );
  };

  const toggleSelectAllCandidates = () => {
    if (selectedCandidates.length === candidateList.length) {
      setSelectedCandidates([]);
    } else {
      setSelectedCandidates(candidateList.map((candidate) => candidate.followed_username));
    }
  };

  const openTagModal = (person: ImportantPerson) => {
    setTagModalPerson(person);
    setTagDraft(person.tags ?? []);
    setTagInputValue('');
  };

  const closeTagModal = () => {
    setTagModalPerson(null);
    setTagDraft([]);
    setTagInputValue('');
  };

  const tagExists = (tag: string, list: string[] = tagDraft) =>
    list.some((item) => item.toLowerCase() === tag.toLowerCase());

  const addTagToDraft = (rawTag: string) => {
    const cleaned = rawTag.trim();
    if (!cleaned || tagExists(cleaned)) {
      return;
    }
    setTagDraft((prev) => [...prev, cleaned]);
  };

  const removeTagFromDraft = (tag: string) => {
    setTagDraft((prev) => prev.filter((item) => item.toLowerCase() !== tag.toLowerCase()));
  };

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault();
      if (tagInputValue.trim()) {
        addTagToDraft(tagInputValue);
        setTagInputValue('');
      }
    } else if (event.key === 'Backspace' && !tagInputValue && tagDraft.length > 0) {
      removeTagFromDraft(tagDraft[tagDraft.length - 1]);
    }
  };

  const handleSaveTags = async () => {
    if (!tagModalPerson) return;
    setIsSavingTags(true);
    try {
      const response = await fetch('/api/ranker/admin/important-person', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: tagModalPerson.username,
          tags: tagDraft,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update tags');
      }
      setMessage({
        type: 'success',
        text: `@${tagModalPerson.username} tags updated`,
      });
      setImportantPeople((prev) => updatePeopleTags(prev, tagModalPerson.username, tagDraft));
      setAllPeople((prev) => updatePeopleTags(prev, tagModalPerson.username, tagDraft));
      setAvailableTags((prev) => {
        const map = new Map(prev.map((tag) => [tag.toLowerCase(), tag]));
        tagDraft.forEach((tag) => {
          const key = tag.toLowerCase();
          if (!map.has(key)) {
            map.set(key, tag);
          }
        });
        return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
      });
      closeTagModal();
    } catch (error) {
      console.error('Error saving tags:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to update tags',
      });
    } finally {
      setIsSavingTags(false);
    }
  };

  const tagSuggestions =
    tagModalPerson && availableTags.length > 0
      ? availableTags
          .filter((tag) => {
            const query = tagInputValue.trim().toLowerCase();
            if (!query) return true;
            return tag.toLowerCase().includes(query);
          })
          .filter((tag) => !tagExists(tag))
          .slice(0, 8)
      : [];

  return (
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <Navbar />

      <div className="relative pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto text-center mb-16">
          <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">
            Important Accounts
          </h1>

          {/* Stats Overview */}
          {syncStatus && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto mt-12">
              <div className="bg-[#FEFEFE] border border-[#E8E4DF] p-6 rounded-sm">
                <div className="text-3xl text-[#2B2B2B] mb-2 font-normal">
                  {syncStatus.summary.total_people}
                </div>
                <div className="text-sm text-[#6B6B6B]">Total</div>
              </div>
              <div className="bg-[#FEFEFE] border border-[#E8E4DF] p-6 rounded-sm">
                <div className="text-3xl text-[#2B2B2B] mb-2 font-normal">
                  {syncStatus.summary.synced_people}
                </div>
                <div className="text-sm text-[#6B6B6B]">Synced</div>
              </div>
              <div className="bg-[#FEFEFE] border border-[#E8E4DF] p-6 rounded-sm">
                <div className="text-3xl text-[#2B2B2B] mb-2 font-normal">
                  {syncStatus.summary.unsynced_people}
                </div>
                <div className="text-sm text-[#6B6B6B]">Pending</div>
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="max-w-6xl mx-auto">
          {/* Check Important Score Section */}
          <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm p-8 mb-8">
            <button
              onClick={() => setIsCheckSectionOpen(!isCheckSectionOpen)}
              className="w-full flex items-center justify-between text-left"
            >
              <h2 className="text-xl font-normal text-[#2B2B2B]">Check Importance Score</h2>
              <span className={`text-[#6B6B6B] transition-transform ${isCheckSectionOpen ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            {isCheckSectionOpen && (
              <div className="mt-8 space-y-6">
                <form onSubmit={handleCheckImportance} className="space-y-6">
                  <div>
                    <label htmlFor="check-username" className="block text-sm text-[#2B2B2B] mb-2">
                      Twitter Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6B6B]">@</span>
                      <input
                        type="text"
                        id="check-username"
                        value={checkUsername}
                        onChange={(e) => setCheckUsername(e.target.value)}
                        placeholder="username"
                        className="w-full pl-10 pr-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] placeholder-[#6B6B6B]/50 focus:border-[#2F6FED] focus:outline-none transition-all font-sans"
                        disabled={isCheckLoading}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isCheckLoading || !checkUsername.trim()}
                    className="w-full bg-[#FEFEFE] text-[#2B2B2B] border border-[#E8E4DF] hover:bg-[#F5F3F0] hover:text-[#2F6FED] hover:border-[#2F6FED] disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
                  >
                    {isCheckLoading ? 'Checking...' : 'Check Score'}
                  </button>
                </form>

                {/* Results Display */}
                {checkResults.length > 0 && (
                  <div className="space-y-4 mt-8">
                    <h3 className="text-lg text-[#2B2B2B]">Results</h3>
                    {checkResults.map((result) => (
                      <div
                        key={result.id}
                        className="bg-[#F5F3F0] border border-[#E8E4DF] rounded-sm p-6 space-y-4 relative"
                      >
                        <button
                          onClick={() => handleRemoveResult(result.id)}
                          className="absolute top-4 right-4 text-[#6B6B6B] hover:text-[#2B2B2B]"
                        >
                          ×
                        </button>

                        <div className="flex items-start justify-between pr-8">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-4 py-2 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] rounded-sm text-base">
                                @{result.found ? result.followed_username || result.username : result.username}
                              </span>
                            </div>
                            {!result.found && (
                              <p className="text-sm text-[#6B6B6B] mt-1">Not found in reverse index</p>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-[#6B6B6B] mb-1">Score</div>
                            <div className="text-3xl text-[#2B2B2B] font-normal">{result.importance_score.toFixed(2)}</div>
                          </div>
                        </div>

                        {result.found && result.followed_by.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-[#E8E4DF]">
                            <div className="text-sm text-[#2B2B2B] mb-3">
                              Followed by {result.followed_by.length} important {result.followed_by.length === 1 ? 'person' : 'people'}:
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {result.followed_by.map((follower) => (
                                <div
                                  key={`${result.id}-${follower.user_id}`}
                                  className="px-3 py-2 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm"
                                >
                                  <div className="text-[#2B2B2B] text-sm">@{follower.username}</div>
                                  {follower.weight !== undefined && follower.weight !== 1 && (
                                    <div className="text-[#6B6B6B] text-xs mt-1">Weight: {follower.weight}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add Important Person Form */}
          <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm p-8 mb-8">
            <h2 className="text-xl font-normal text-[#2B2B2B] mb-6">Add Person</h2>
            
            <form onSubmit={handleAddPerson} className="space-y-6">
              <div>
                <label htmlFor="username" className="block text-sm text-[#2B2B2B] mb-2">
                  Twitter Username
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6B6B]">@</span>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="w-full pl-10 pr-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] placeholder-[#6B6B6B]/50 focus:border-[#2F6FED] focus:outline-none transition-all font-sans"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !username.trim()}
                className="w-full bg-[#FEFEFE] text-[#2B2B2B] border border-[#E8E4DF] hover:bg-[#F5F3F0] hover:text-[#2F6FED] hover:border-[#2F6FED] disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
              >
                {isLoading ? 'Adding...' : 'Add Person'}
              </button>
            </form>

            {message && (
              <div
                className={`mt-6 p-4 rounded-sm border text-sm ${
                  message.type === 'success'
                    ? 'border-[#E8E4DF] text-[#2B2B2B] bg-[#F5F3F0]'
                    : 'border-red-200 text-red-600 bg-red-50'
                }`}
              >
                {message.text}
              </div>
            )}
          </div>

          {/* Important People Table */}
          <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
              <h2 className="text-xl font-normal text-[#2B2B2B]">People List</h2>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={openCandidateModal}
                  className="px-4 py-2 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:bg-[#F5F3F0] hover:text-[#2F6FED] hover:border-[#2F6FED] text-sm rounded-sm transition-all"
                >
                  Extract Accounts
                </button>
                <button
                  onClick={() => {
                    clearAllPeopleCache();
                    fetchImportantPeople();
                    fetchSyncStatus();
                  }}
                  disabled={isFetching}
                  className="px-4 py-2 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:bg-[#F5F3F0] hover:text-[#2F6FED] hover:border-[#2F6FED] text-sm rounded-sm transition-all disabled:opacity-50"
                >
                  {isFetching ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="mb-6 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {(['all', 'synced', 'unsynced'] as const).map((filterKey) => {
                    const isActive = syncFilter === filterKey;
                    const label =
                      filterKey === 'all'
                        ? 'All'
                        : filterKey === 'synced'
                        ? 'Synced'
                        : 'Not synced';
                    return (
                      <button
                        key={filterKey}
                        onClick={() => setSyncFilter(filterKey)}
                        className={`px-3 py-1.5 rounded-sm border text-xs transition ${
                          isActive
                            ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white'
                            : 'border-[#E8E4DF] text-[#6B6B6B] hover:text-[#2F6FED] hover:border-[#2F6FED]'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                
                <div className="relative w-full max-w-md">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search people..."
                    className="w-full px-4 py-2 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] placeholder-[#6B6B6B]/50 focus:border-[#2F6FED] focus:outline-none transition-all font-sans text-sm"
                    disabled={isSearching}
                  />
                </div>
              </div>
              
              <div className="text-sm text-[#6B6B6B]">
                {isSearching ? (
                  <span>Searching...</span>
                ) : (
                  <span>
                    Showing {filteredPeople.length} of {baseList.length || totalPeople} people
                  </span>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm border-b border-[#E8E4DF]">
                  <tr>
                    <th className="py-4 px-4 font-normal">Username</th>
                    <th className="py-4 px-4 font-normal">Name</th>
                    <th className="py-4 px-4 font-normal">Weight</th>
                    <th className="py-4 px-4 font-normal">Networth</th>
                    <th className="py-4 px-4 font-normal">Tags</th>
                    <th className="py-4 px-4 font-normal">Following</th>
                    <th className="py-4 px-4 font-normal">Last Synced</th>
                    <th className="py-4 px-4 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E4DF]">
                  {filteredPeople.map((person) => {
                    const weightValue = weightEdits[person.username] ?? (person.weight ?? 1).toString();
                    const parsedWeight = Number(weightValue);
                    const isWeightValid = Number.isFinite(parsedWeight) && parsedWeight > 0;
                    const hasWeightChanged = isWeightValid && Math.abs(parsedWeight - (person.weight ?? 1)) >= 0.0001;
                    const isUpdatingThisWeight = updatingWeight === person.username;
                    
                    const networthValue = networthEdits[person.username] ?? (person.networth !== undefined ? person.networth.toString() : '');
                    const trimmedNetworthValue = networthValue.trim();
                    const parsedNetworth = trimmedNetworthValue === '' ? null : Number(trimmedNetworthValue);
                    const isNetworthValid = trimmedNetworthValue === '' || (Number.isFinite(parsedNetworth) && parsedNetworth !== null && parsedNetworth >= 0);
                    const hasNetworthChanged = isNetworthValid && parsedNetworth !== (person.networth ?? null);
                    const isUpdatingThisNetworth = updatingNetworth === person.username;
                    
                    const personTags = person.tags ?? [];

                    return (
                      <tr key={person.username} className="hover:bg-[#F5F3F0]/50 transition-colors">
                        <td className="py-4 px-4 font-medium text-[#2B2B2B]">@{person.username}</td>
                        <td className="py-4 px-4 text-[#6B6B6B]">{person.name || '-'}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0.1}
                              step={0.1}
                              value={weightValue}
                              disabled={isUpdatingThisWeight}
                              onChange={(e) => handleWeightInputChange(person.username, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && hasWeightChanged && isWeightValid && !isUpdatingThisWeight) {
                                  handleWeightSave(person);
                                }
                              }}
                              className="w-16 px-2 py-1 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] text-sm"
                            />
                            {hasWeightChanged && isWeightValid && !isUpdatingThisWeight && (
                              <button onClick={() => handleWeightSave(person)} className="text-[#2B2B2B] hover:text-[#2F6FED] text-xs underline">Save</button>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder="-"
                              value={networthValue}
                              disabled={isUpdatingThisNetworth}
                              onChange={(e) => handleNetworthInputChange(person.username, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && hasNetworthChanged && isNetworthValid && !isUpdatingThisNetworth) {
                                  handleNetworthSave(person);
                                }
                              }}
                              className="w-24 px-2 py-1 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] text-sm"
                            />
                            {hasNetworthChanged && isNetworthValid && !isUpdatingThisNetworth && (
                              <button onClick={() => handleNetworthSave(person)} className="text-[#2B2B2B] hover:text-[#2F6FED] text-xs underline">Save</button>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex flex-wrap gap-1 mb-1">
                            {personTags.map((tag) => (
                              <span key={tag} className="text-xs text-[#6B6B6B] bg-[#F5F3F0] px-1.5 py-0.5 rounded-sm">#{tag}</span>
                            ))}
                          </div>
                          <button onClick={() => openTagModal(person)} className="text-xs text-[#2B2B2B] hover:text-[#2F6FED] underline">Edit</button>
                        </td>
                        <td className="py-4 px-4 text-[#2B2B2B]">{person.following_count.toLocaleString()}</td>
                        <td className="py-4 px-4 text-sm text-[#6B6B6B]">
                          {getTimeSince(person.last_synced)}
                        </td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex items-center gap-3 justify-end">
                            <button
                              onClick={() => setConfirmAction({ type: 'sync', username: person.username })}
                              disabled={syncingUsername !== null}
                              className="inline-flex items-center justify-center rounded-sm border border-transparent p-1 text-[#2F6FED] hover:border-[#2F6FED] hover:bg-[#F5F3F0] disabled:opacity-50"
                              aria-label={syncingUsername === person.username ? `Syncing @${person.username}` : `Sync @${person.username}`}
                              title={syncingUsername === person.username ? 'Syncing...' : 'Sync'}
                            >
                              <RefreshCw className={syncingUsername === person.username ? 'animate-spin' : ''} size={16} />
                            </button>
                            <button
                              onClick={() => setConfirmAction({ type: 'remove', username: person.username })}
                              className="inline-flex items-center justify-center rounded-sm border border-transparent p-1 text-red-600 hover:border-red-600 hover:bg-red-50"
                              aria-label={`Remove @${person.username}`}
                              title="Remove"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {!searchQuery && totalPages > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                <button
                  onClick={() => fetchImportantPeople(currentPage - 1)}
                  disabled={currentPage === 1 || isFetching}
                  className="px-3 py-1 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:border-[#2F6FED] hover:text-[#2F6FED] disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="px-3 py-1 text-[#6B6B6B]">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => fetchImportantPeople(currentPage + 1)}
                  disabled={currentPage === totalPages || isFetching}
                  className="px-3 py-1 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:border-[#2F6FED] hover:text-[#2F6FED] disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Candidate Modal */}
      {isCandidateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F5F3F0]/90">
          <div className="bg-[#FEFEFE] max-w-4xl w-full mx-4 rounded-sm border border-[#E8E4DF] p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-xl text-[#2B2B2B]">Candidate Accounts</h3>
              <button onClick={closeCandidateModal} className="text-[#6B6B6B] hover:text-[#2B2B2B]">Close</button>
            </div>
            
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-[#F5F3F0] border border-[#E8E4DF]">
               <div>
                 <label className="block text-sm text-[#2B2B2B] mb-1">Min Followers</label>
                 <input
                    type="number"
                    min={1}
                    value={candidateMinFollowers}
                    onChange={(e) => setCandidateMinFollowers(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B]"
                 />
               </div>
               <div className="flex items-end">
                 <button onClick={fetchCandidates} className="px-4 py-2 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:text-[#2F6FED] hover:border-[#2F6FED] text-sm w-full">Apply Filters</button>
               </div>
            </div>

            {candidateLoading ? (
              <p className="text-center py-8 text-[#6B6B6B]">Loading candidates...</p>
            ) : candidateList.length === 0 ? (
               <p className="text-center py-8 text-[#6B6B6B]">No candidates found.</p>
            ) : (
              <div>
                <div className="flex justify-between mb-4">
                  <div className="text-sm text-[#6B6B6B]">{selectedCandidates.length} selected</div>
                  <button
                    onClick={handleBatchAdd}
                    disabled={selectedCandidates.length === 0 || isBatchAdding}
                    className="px-4 py-2 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:text-[#2F6FED] hover:border-[#2F6FED] text-sm disabled:opacity-50"
                  >
                    Add Selected
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#E8E4DF]">
                        <th className="py-2 px-2"><input type="checkbox" onChange={toggleSelectAllCandidates} /></th>
                        <th className="py-2 px-2 font-normal text-[#6B6B6B]">Username</th>
                        <th className="py-2 px-2 font-normal text-[#6B6B6B]">Followers</th>
                        <th className="py-2 px-2 font-normal text-[#6B6B6B]">Score</th>
                        <th className="py-2 px-2 font-normal text-[#6B6B6B]">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E4DF]">
                      {candidateList.map((candidate) => (
                        <tr key={candidate.followed_username}>
                          <td className="py-2 px-2">
                            <input
                              type="checkbox"
                              checked={selectedCandidates.includes(candidate.followed_username)}
                              onChange={() => toggleCandidateSelection(candidate.followed_username)}
                            />
                          </td>
                          <td className="py-2 px-2 text-[#2B2B2B]">@{candidate.followed_username}</td>
                          <td className="py-2 px-2 text-[#2B2B2B]">{candidate.follower_count}</td>
                          <td className="py-2 px-2 text-[#2B2B2B]">{candidate.importance_score.toFixed(1)}</td>
                          <td className="py-2 px-2">
                            <button
                               onClick={() => handleAddCandidate(candidate)}
                               className="text-[#2B2B2B] hover:text-[#2F6FED] underline"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tag Modal */}
      {tagModalPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F5F3F0]/90">
          <div className="bg-[#FEFEFE] max-w-lg w-full mx-4 rounded-sm border border-[#E8E4DF] p-8">
            <h3 className="text-xl text-[#2B2B2B] mb-4">Edit Tags: @{tagModalPerson.username}</h3>
            
            <div className="mb-4">
              <div className="flex flex-wrap gap-2 mb-2">
                {tagDraft.map(tag => (
                  <span key={tag} className="px-2 py-1 bg-[#F5F3F0] text-[#2B2B2B] text-sm flex items-center gap-1">
                    #{tag}
                    <button onClick={() => removeTagFromDraft(tag)}>×</button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={tagInputValue}
                onChange={(e) => setTagInputValue(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
                placeholder="Type tag and press Enter"
                className="w-full px-3 py-2 border border-[#E8E4DF] text-[#2B2B2B]"
              />
            </div>
            
            <div className="mb-4">
              <p className="text-xs text-[#6B6B6B] mb-2">Suggestions</p>
              <div className="flex flex-wrap gap-2">
                {tagSuggestions.map(tag => (
                  <button
                    key={tag}
                    onClick={() => { addTagToDraft(tag); setTagInputValue(''); }}
                    className="px-2 py-1 border border-[#E8E4DF] text-xs text-[#6B6B6B] hover:bg-[#F5F3F0]"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={closeTagModal} className="text-[#6B6B6B] hover:text-[#2B2B2B]">Cancel</button>
              <button onClick={handleSaveTags} className="bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:text-[#2F6FED] hover:border-[#2F6FED] px-4 py-2 text-sm rounded-sm">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F5F3F0]/90">
          <div className="bg-[#FEFEFE] max-w-md w-full mx-4 rounded-sm border border-[#E8E4DF] p-8">
            <h3 className="text-xl text-[#2B2B2B] mb-3">
              {confirmAction.type === 'sync' ? 'Confirm sync' : 'Confirm removal'}
            </h3>
            <p className="text-sm text-[#6B6B6B] mb-6">
              {confirmAction.type === 'sync'
                ? `Sync @${confirmAction.username} now?`
                : `Remove @${confirmAction.username} from Important Accounts?`}
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="text-[#6B6B6B] hover:text-[#2B2B2B]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const next = confirmAction;
                  setConfirmAction(null);
                  if (next.type === 'sync') {
                    handleSyncPerson(next.username);
                  } else {
                    handleRemovePerson(next.username);
                  }
                }}
                disabled={confirmAction.type === 'sync' && syncingUsername !== null}
                className={`px-4 py-2 text-sm rounded-sm border transition-all disabled:opacity-50 ${
                  confirmAction.type === 'sync'
                    ? 'bg-[#FEFEFE] border-[#2F6FED] text-[#2F6FED] hover:bg-[#F5F3F0]'
                    : 'bg-[#FEFEFE] border-red-600 text-red-600 hover:bg-red-50'
                }`}
              >
                {confirmAction.type === 'sync' ? 'Sync' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

