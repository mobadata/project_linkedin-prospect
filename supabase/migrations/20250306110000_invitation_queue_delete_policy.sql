-- Permettre à l'utilisateur de supprimer ses propres entrées en attente (pour arrêter la campagne)
create policy "Users can delete own queue"
  on public.invitation_queue for delete
  using (auth.uid() = user_id);
